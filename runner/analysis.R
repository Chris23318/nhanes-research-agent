args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 4) stop("usage: analysis.R CACHE_DIR OUTPUT_DIR CYCLES AGE_MIN")
cache_dir <- normalizePath(args[[1]], mustWork = TRUE)
output_dir <- args[[2]]
cycle_count <- as.integer(args[[3]])
age_min <- as.integer(args[[4]])
if (!is.finite(cycle_count) || cycle_count < 1 || cycle_count > 6) stop("invalid cycle count")
if (!is.finite(age_min) || age_min < 18 || age_min > 85) stop("invalid age minimum")
dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)
suppressPackageStartupMessages({ library(haven); library(survey); library(jsonlite) })
options(survey.lonely.psu = "adjust")
suffixes <- c("E", "F", "G", "H", "I", "J")
available <- suffixes[file.exists(file.path(cache_dir, paste0("VID_", suffixes, ".XPT")))]
if (length(available) != cycle_count) stop("cached cycle count does not match the approved specification")
required_codes <- as.vector(outer(c("DEMO", "VID", "DPQ", "BMX"), available, paste, sep = "_"))
missing_files <- required_codes[!file.exists(file.path(cache_dir, paste0(required_codes, ".XPT")))]
if (length(missing_files)) stop(paste("missing cached files:", paste(missing_files, collapse = ", ")))
read_cycle <- function(suffix) {
  demo <- read_xpt(file.path(cache_dir, paste0("DEMO_", suffix, ".XPT")))
  vid <- read_xpt(file.path(cache_dir, paste0("VID_", suffix, ".XPT")))
  dpq <- read_xpt(file.path(cache_dir, paste0("DPQ_", suffix, ".XPT")))
  bmx <- read_xpt(file.path(cache_dir, paste0("BMX_", suffix, ".XPT")))
  demo <- demo[intersect(c("SEQN", "RIDAGEYR", "RIAGENDR", "RIDRETH1", "INDFMPIR", "WTMEC2YR", "SDMVSTRA", "SDMVPSU"), names(demo))]
  vid <- vid[intersect(c("SEQN", "LBXVIDMS"), names(vid))]
  dpq <- dpq[intersect(c("SEQN", sprintf("DPQ%03d", seq(10, 90, 10))), names(dpq))]
  bmx <- bmx[intersect(c("SEQN", "BMXBMI"), names(bmx))]
  merged <- Reduce(function(x, y) merge(x, y, by = "SEQN", all = FALSE), list(demo, vid, dpq, bmx))
  merged$cycle_suffix <- suffix
  merged
}
raw <- do.call(rbind, lapply(available, read_cycle))
phq_items <- sprintf("DPQ%03d", seq(10, 90, 10))
required_variables <- c("SEQN", "LBXVIDMS", phq_items, "RIDAGEYR", "RIAGENDR", "RIDRETH1", "INDFMPIR", "BMXBMI", "WTMEC2YR", "SDMVSTRA", "SDMVPSU")
missing_variables <- setdiff(required_variables, names(raw))
if (length(missing_variables)) stop(paste("missing variables:", paste(missing_variables, collapse = ", ")))
for (name in phq_items) raw[[name]][!(raw[[name]] %in% 0:3)] <- NA
raw$phq_complete <- rowSums(!is.na(raw[phq_items])) == 9
raw$phq9_total <- rowSums(raw[phq_items], na.rm = TRUE)
raw$depression <- as.integer(raw$phq_complete & raw$phq9_total >= 10)
adult <- raw[raw$RIDAGEYR >= age_min, ]
model_variables <- c("depression", "LBXVIDMS", "RIDAGEYR", "RIAGENDR", "RIDRETH1", "INDFMPIR", "BMXBMI", "WTMEC2YR", "SDMVSTRA", "SDMVPSU")
analytic <- adult[adult$phq_complete & complete.cases(adult[model_variables]) & adult$WTMEC2YR > 0, ]
if (nrow(analytic) < 100) stop("fewer than 100 complete analytic observations")
analytic$pooled_weight <- analytic$WTMEC2YR / cycle_count
design <- svydesign(ids = ~SDMVPSU, strata = ~SDMVSTRA, weights = ~pooled_weight, nest = TRUE, data = analytic)
model <- svyglm(depression ~ I(LBXVIDMS / 10) + RIDAGEYR + factor(RIAGENDR) + factor(RIDRETH1) + INDFMPIR + BMXBMI, design = design, family = quasibinomial())
coefficient_frame <- function(fit, exponentiate = TRUE, model_name = "primary") {
  matrix <- summary(fit)$coefficients
  confidence <- suppressMessages(confint(fit))
  data.frame(model = model_name, term = rownames(matrix), estimate = matrix[, 1], std_error = matrix[, 2], statistic = matrix[, 3], p_value = matrix[, 4], effect = if (exponentiate) exp(matrix[, 1]) else matrix[, 1], ci_low = if (exponentiate) exp(confidence[, 1]) else confidence[, 1], ci_high = if (exponentiate) exp(confidence[, 2]) else confidence[, 2], effect_type = if (exponentiate) "odds_ratio" else "beta", row.names = NULL)
}
coefficients <- coefficient_frame(model)
write.csv(coefficients, file.path(output_dir, "model-coefficients.csv"), row.names = FALSE)
weighted_means <- svymean(~depression + LBXVIDMS + phq9_total, design, na.rm = TRUE)
descriptives <- data.frame(measure = names(coef(weighted_means)), estimate = as.numeric(coef(weighted_means)), std_error = as.numeric(SE(weighted_means)))
quartile_cutpoints <- as.numeric(svyquantile(~LBXVIDMS, design, quantiles = c(0.25, 0.5, 0.75), ci = FALSE))
analytic$vitamin_quartile <- cut(analytic$LBXVIDMS, breaks = c(-Inf, quartile_cutpoints, Inf), labels = c("Q1", "Q2", "Q3", "Q4"), include.lowest = TRUE)
quartile_design <- svydesign(ids = ~SDMVPSU, strata = ~SDMVSTRA, weights = ~pooled_weight, nest = TRUE, data = analytic)
quartile_model <- svyglm(depression ~ factor(vitamin_quartile) + RIDAGEYR + factor(RIAGENDR) + factor(RIDRETH1) + INDFMPIR + BMXBMI, design = quartile_design, family = quasibinomial())
continuous_phq_model <- svyglm(phq9_total ~ I(LBXVIDMS / 10) + RIDAGEYR + factor(RIAGENDR) + factor(RIDRETH1) + INDFMPIR + BMXBMI, design = design, family = gaussian())
interaction_model <- svyglm(depression ~ I(LBXVIDMS / 10) * factor(RIAGENDR) + RIDAGEYR + factor(RIDRETH1) + INDFMPIR + BMXBMI, design = design, family = quasibinomial())
sensitivity_coefficients <- rbind(coefficient_frame(quartile_model, TRUE, "vitamin_d_quartiles"), coefficient_frame(continuous_phq_model, FALSE, "continuous_phq9"), coefficient_frame(interaction_model, TRUE, "sex_interaction"))
write.csv(sensitivity_coefficients, file.path(output_dir, "sensitivity-coefficients.csv"), row.names = FALSE)
flow <- list(merged = nrow(raw), adults = nrow(adult), complete_phq9 = sum(adult$phq_complete), analytic_complete_case = nrow(analytic), depression_cases = sum(analytic$depression))
result <- list(schemaVersion = "1.1", status = "completed", analysis = "survey-weighted quasibinomial logistic regression", exposureUnit = "odds ratio per 10 nmol/L higher LBXVIDMS", cycles = available, weightRule = paste0("WTMEC2YR / ", cycle_count), flow = flow, descriptives = descriptives, quartileCutpointsNmolL = quartile_cutpoints, coefficients = coefficients, sensitivityCoefficients = sensitivity_coefficients, warnings = c("Cross-sectional association; causal interpretation is not supported.", "Primary analysis uses complete PHQ-9 items and complete-case covariates.", "Quartile cutpoints are survey-weighted and estimated in the analytic sample.", "Sex interaction and continuous PHQ-9 analyses are prespecified sensitivity analyses, not independent confirmatory tests.", "Cycle-specific codebooks and assay notes remain part of final scientific review."), runtime = list(rVersion = R.version.string, surveyVersion = as.character(packageVersion("survey")), havenVersion = as.character(packageVersion("haven")), completedAt = format(Sys.time(), tz = "UTC", usetz = TRUE)))
write_json(result, file.path(output_dir, "result.json"), auto_unbox = TRUE, pretty = TRUE, digits = NA)
main_exposure <- coefficients[coefficients$term == "I(LBXVIDMS/10)", ]
writeLines(c("# NHANES analysis execution report", "", paste("Completed:", result$runtime$completedAt), paste("Analytic sample:", flow$analytic_complete_case), paste("Depression cases:", flow$depression_cases), sprintf("Vitamin D per 10 nmol/L: OR %.3f (95%% CI %.3f to %.3f), p=%.4f", main_exposure$effect, main_exposure$ci_low, main_exposure$ci_high, main_exposure$p_value), "", "## Sensitivity analyses", "- Survey-weighted vitamin D quartiles (Q1 reference)", "- Continuous PHQ-9 score", "- Vitamin D by sex interaction", "", "Results describe cross-sectional associations, not causal effects. See sensitivity-coefficients.csv and result.json for complete estimates."), file.path(output_dir, "REPORT.md"))
