function safe(value) { if (!/^[A-Z][A-Z0-9_]{0,39}$/.test(value)) throw new Error('unsafe variable in model specification'); return value; }
function cycleLiteral(value) { if (!/^20\d{2}-20\d{2}$/.test(value)) throw new Error('unsafe cycle in model specification'); return `"${value}"`; }
function cycleExpression(mappings) {
  const clauses = [];
  for (const mapping of mappings) for (const cycle of mapping.cycles) clauses.push(`analytic[[".nhanes_cycle"]] == "${cycle}" ~ as.numeric(analytic[["${safe(mapping.variable)}"]])`);
  return `case_when(${clauses.join(', ')}, TRUE ~ NA_real_)`;
}
function generateModelScript(spec) {
  if (!spec) return '# Statistical model has not been approved.\nstop("Approve model specification first")\n';
  if (!Array.isArray(spec.exposureMappings) || !Array.isArray(spec.outcomeMappings) || !Array.isArray(spec.covariates) || !Array.isArray(spec.cycles) || !Number.isFinite(spec.population?.ageMin)) return '# Statistical model specification is invalid.\nstop("Regenerate model specification")\n';
  const exposure = cycleExpression(spec.exposureMappings), outcome = cycleExpression(spec.outcomeMappings);
  const covariates = spec.covariates.map((item,index)=>({name:`cov_${index+1}`,mappings:item.mappings,encoding:item.encoding}));
  const formula = `analysis_outcome ~ ${['analysis_exposure',...covariates.map(x=>x.name)].join(' + ')}`;
  const weightDivisor=Number(spec.weightPolicy?.divisor||spec.cycles.length),weightRule=`${safe(spec.weightVariable)} / ${weightDivisor}`;
  if(!Number.isInteger(weightDivisor)||weightDivisor<1)throw new Error('invalid pooled weight divisor in model specification');
  const exposureTransform = spec.exposureTransform === 'log2' ? ['if (any(analytic$analysis_exposure <= 0, na.rm=TRUE)) stop("log2 exposure requires positive values")','analytic$analysis_exposure <- log2(analytic$analysis_exposure)'] : spec.exposureTransform === 'per_sd' ? ['scale_value <- sd(analytic$analysis_exposure,na.rm=TRUE)','if (!is.finite(scale_value) || scale_value <= 0) stop("Exposure SD is invalid")','analytic$analysis_exposure <- analytic$analysis_exposure / scale_value'] : [];
  const outcomeTransform = spec.outcomeTransform === 'threshold_ge' ? [`analytic$analysis_outcome <- as.integer(analytic$analysis_outcome >= ${spec.outcomeThreshold})`] : spec.outcomeTransform === 'threshold_eq' ? [`analytic$analysis_outcome <- as.integer(analytic$analysis_outcome == ${spec.outcomeThreshold})`] : [];
  const family = spec.outcomeFamily === 'binary' ? 'quasibinomial()' : 'gaussian()';
  return [
    '# Generated from an approved model specification. Review artifacts before interpretation.',
    'suppressPackageStartupMessages({ library(survey); library(dplyr); library(jsonlite) })', 'options(survey.lonely.psu="adjust")',
    'args <- commandArgs(trailingOnly=TRUE)', 'if (length(args)<2) stop("Usage: Rscript model.R MERGED_RDS OUTPUT_DIR")',
    'analytic <- readRDS(args[[1]])', 'assembled_n <- nrow(analytic)', 'output_dir <- args[[2]]', 'dir.create(output_dir,recursive=TRUE,showWarnings=FALSE)',
    'if (!("RIDAGEYR" %in% names(analytic))) stop("RIDAGEYR is required for the approved population restriction")',
    `analytic <- analytic[is.finite(as.numeric(analytic[["RIDAGEYR"]])) & as.numeric(analytic[["RIDAGEYR"]]) >= ${spec.population.ageMin},,drop=FALSE]`,
    'population_n <- nrow(analytic)',
    `analytic$analysis_exposure <- ${exposure}`, `analytic$analysis_outcome <- ${outcome}`,
    ...outcomeTransform,
    ...covariates.map(x=>`analytic$${x.name} <- ${x.encoding==='factor'?`factor(${cycleExpression(x.mappings)})`:`as.numeric(${cycleExpression(x.mappings)})`}`),
    ...exposureTransform,
    `analytic$analysis_weight <- as.numeric(analytic[["${safe(spec.weightVariable)}"]]) / ${weightDivisor}`,
    `required <- c("analysis_outcome","analysis_exposure","analysis_weight","${safe(spec.strataVariable)}","${safe(spec.psuVariable)}"${covariates.map(x=>`,"${x.name}"`).join('')})`,
    'missing_row <- function(name) { value <- analytic[[name]]; missing <- is.na(value); if (is.numeric(value)) missing <- missing | !is.finite(value); data.frame(variable=name,missing_n=sum(missing),missing_pct=100*mean(missing)) }',
    'missingness_result <- bind_rows(lapply(required,missing_row))',
    'finite_numeric <- is.finite(analytic$analysis_outcome) & is.finite(analytic$analysis_exposure) & is.finite(analytic$analysis_weight)',
    ...covariates.filter(x=>x.encoding==='continuous').map(x=>`finite_numeric <- finite_numeric & is.finite(analytic$${x.name})`),
    'complete <- complete.cases(analytic[,required,drop=FALSE]) & finite_numeric & analytic$analysis_weight > 0',
    'flow <- data.frame(stage=c("assembled","population_eligible","complete_case"),n=c(assembled_n,population_n,sum(complete)))',
    'complete_case_diagnostics <- list(populationN=population_n,completeN=sum(complete),retention=as.numeric(sum(complete)/population_n))',
    'analytic <- droplevels(analytic[complete,,drop=FALSE])', 'if (nrow(analytic)<30) stop("Fewer than 30 complete observations")',
    `design <- svydesign(ids=~${safe(spec.psuVariable)},strata=~${safe(spec.strataVariable)},weights=~analysis_weight,nest=TRUE,data=analytic)`,
    'if (degf(design)<=0) stop("Survey design degrees of freedom are not positive")',
    ...(spec.outcomeFamily === 'binary' ? ['if (length(unique(analytic$analysis_outcome)) != 2) stop("Binary outcome must contain both classes")'] : []),
    'describe_one <- function(name) {',
    '  value <- analytic[[name]]; estimate <- svymean(as.formula(paste0("~",name)),design,na.rm=TRUE); intervals <- confint(estimate); estimates <- as.numeric(coef(estimate)); errors <- as.numeric(SE(estimate))',
    '  if (is.factor(value)) { counts <- as.integer(table(value,useNA="no")); labels <- levels(value); if (length(counts)!=length(estimates)) stop(paste("Descriptive level mismatch for",name)); metric <- rep("weighted_proportion",length(estimates)) } else { counts <- sum(is.finite(value)); labels <- ""; metric <- if (name=="analysis_outcome" && '+(spec.outcomeFamily === 'binary' ? 'TRUE' : 'FALSE')+') "weighted_prevalence" else "weighted_mean" }',
    '  data.frame(variable=name,level=labels,metric=metric,unweighted_n=counts,estimate=estimates,std_error=errors,ci_low=as.numeric(intervals[,1]),ci_high=as.numeric(intervals[,2]))',
    '}',
    `descriptive_names <- c("analysis_exposure","analysis_outcome"${covariates.map(x=>`,"${x.name}"`).join('')})`,
    'descriptive_result <- bind_rows(lapply(descriptive_names,describe_one))',
    'if (nrow(descriptive_result)<2 || any(!is.finite(as.matrix(descriptive_result[c("estimate","std_error","ci_low","ci_high")]))) ) stop("Invalid descriptive statistics")',
    `model <- svyglm(${formula},design=design,family=${family})`,
    'est <- coef(model); ci <- confint(model); tab <- summary(model)$coefficients',
    'if (any(!is.finite(est)) || any(!is.finite(ci))) stop("Nonfinite model result")',
    'condition_number <- tryCatch(as.numeric(kappa(model.matrix(model),exact=FALSE)),error=function(e) NA_real_)',
    'model_diagnostics <- list(converged=isTRUE(model$converged),rank=as.numeric(model$rank),parameters=length(est),residualDf=as.numeric(df.residual(model)),conditionNumber=condition_number)',
    'coefficient_result <- data.frame(term=names(est),estimate=as.numeric(est),std_error=as.numeric(tab[,2]),p_value=as.numeric(tab[,4]),ci_low=as.numeric(ci[,1]),ci_high=as.numeric(ci[,2]))',
    spec.outcomeFamily === 'binary' ? 'coefficient_result$effect <- exp(coefficient_result$estimate); coefficient_result$ci_low <- exp(coefficient_result$ci_low); coefficient_result$ci_high <- exp(coefficient_result$ci_high); coefficient_result$effect_type <- "odds_ratio"' : 'coefficient_result$effect <- coefficient_result$estimate; coefficient_result$effect_type <- "beta"',
    'extract_exposure <- function(fitted,label) {',
    '  estimates <- coef(fitted); intervals <- confint(fitted); table <- summary(fitted)$coefficients',
    '  if (!("analysis_exposure" %in% names(estimates))) stop(paste(label,"has no exposure coefficient"))',
    '  row <- data.frame(model=label,term="analysis_exposure",estimate=as.numeric(estimates[["analysis_exposure"]]),std_error=as.numeric(table["analysis_exposure",2]),p_value=as.numeric(table["analysis_exposure",4]),ci_low=as.numeric(intervals["analysis_exposure",1]),ci_high=as.numeric(intervals["analysis_exposure",2]))',
    spec.outcomeFamily === 'binary' ? '  row$effect <- exp(row$estimate); row$ci_low <- exp(row$ci_low); row$ci_high <- exp(row$ci_high); row$effect_type <- "odds_ratio"' : '  row$effect <- row$estimate; row$effect_type <- "beta"',
    '  row', '}',
    `unadjusted_model <- svyglm(analysis_outcome ~ analysis_exposure,design=design,family=${family})`,
    'weight_limits <- as.numeric(quantile(analytic$analysis_weight,probs=c(0.01,0.99),na.rm=TRUE,names=FALSE,type=8))',
    'if (length(weight_limits)!=2 || any(!is.finite(weight_limits)) || weight_limits[1]<=0 || weight_limits[1]>weight_limits[2]) stop("Weight trimming limits are invalid")',
    'trimmed_data <- analytic',
    'trimmed_data$analysis_weight <- pmin(pmax(trimmed_data$analysis_weight,weight_limits[1]),weight_limits[2])',
    `trimmed_design <- svydesign(ids=~${safe(spec.psuVariable)},strata=~${safe(spec.strataVariable)},weights=~analysis_weight,nest=TRUE,data=trimmed_data)`,
    `trimmed_model <- svyglm(${formula},design=trimmed_design,family=${family})`,
    'sensitivity_result <- bind_rows(extract_exposure(unadjusted_model,"unadjusted"),extract_exposure(trimmed_model,"weight_trim_1_99"))',
    'if (any(!is.finite(as.matrix(sensitivity_result[c("effect","ci_low","ci_high","p_value")]))) ) stop("Nonfinite sensitivity result")',
    'weight_quantiles <- as.numeric(quantile(analytic$analysis_weight,probs=c(0,0.01,0.5,0.99,1),na.rm=TRUE,names=FALSE,type=8))',
    `design_diagnostics <- list(degreesFreedom=as.numeric(degf(design)),strata=length(unique(analytic[["${safe(spec.strataVariable)}"]])),psu=length(unique(interaction(analytic[["${safe(spec.strataVariable)}"]],analytic[["${safe(spec.psuVariable)}"]],drop=TRUE))))`,
    'weight_diagnostics <- list(min=weight_quantiles[1],p01=weight_quantiles[2],median=weight_quantiles[3],p99=weight_quantiles[4],max=weight_quantiles[5],positive=sum(analytic$analysis_weight>0),trimmed=sum(analytic$analysis_weight<weight_limits[1] | analytic$analysis_weight>weight_limits[2]))',
    'write.csv(flow,file.path(output_dir,"model-sample-flow.csv"),row.names=FALSE)', 'write.csv(missingness_result,file.path(output_dir,"missingness-diagnostics.csv"),row.names=FALSE)', 'write.csv(descriptive_result,file.path(output_dir,"descriptive-statistics.csv"),row.names=FALSE)', 'write.csv(coefficient_result,file.path(output_dir,"model-coefficients.csv"),row.names=FALSE)', 'write.csv(sensitivity_result,file.path(output_dir,"sensitivity-coefficients.csv"),row.names=FALSE)',
    'runtime <- list(rVersion=R.version.string,surveyVersion=as.character(packageVersion("survey")),havenVersion=as.character(packageVersion("haven")),completedAt=format(Sys.time(),tz="UTC",usetz=TRUE))',
    `result_document <- list(schemaVersion="2.3",status="completed",analysisMode="generic_survey_v4",analysis="survey-weighted ${spec.outcomeFamily} regression",exposureUnit="${spec.exposureTransform}",cycles=c(${spec.cycles.map(cycleLiteral).join(',')}),weightRule="${weightRule}",weightDiagnostics=weight_diagnostics,designDiagnostics=design_diagnostics,missingnessDiagnostics=missingness_result,completeCaseDiagnostics=complete_case_diagnostics,modelDiagnostics=model_diagnostics,descriptiveStatistics=descriptive_result,flow=list(merged=assembled_n,population_eligible=population_n,analytic_complete_case=nrow(analytic)${spec.outcomeFamily === 'binary' ? ',outcome_cases=sum(analytic$analysis_outcome==1)' : ''}),coefficients=coefficient_result,sensitivityCoefficients=sensitivity_result,sensitivityPlan=c("unadjusted","weight_trim_1_99"),warnings=c("Cross-sectional association; causal interpretation is not supported.","Primary model uses complete cases; variable-level missingness and retention are reported, but multiple imputation was not executed.","Pregnancy restriction was not applied unless encoded in the approved population definition."),modelSpecDigest="${spec.digest}",runtime=runtime)`,
    'write_json(result_document,file.path(output_dir,"result.json"),auto_unbox=TRUE,pretty=TRUE,digits=NA,na="null")',
    'saveRDS(list(model=model,unadjusted_model=unadjusted_model,trimmed_model=trimmed_model,spec_digest="'+spec.digest+'",session=sessionInfo()),file.path(output_dir,"model.rds"))'
  ].join('\n');
}
module.exports = { generateModelScript };
