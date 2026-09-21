set.seed(20260921)

n_strata <- 4L
psu_per_stratum <- 2L
n_per_psu <- 10L
n <- n_strata * psu_per_stratum * n_per_psu

stratum <- rep(seq_len(n_strata), each = psu_per_stratum * n_per_psu)
psu <- rep(seq_len(n_strata * psu_per_stratum), each = n_per_psu)
x <- rnorm(n)
z_complete <- 0.4 * x + rnorm(n)
y <- 1.5 + 0.7 * x - 0.3 * z_complete + rnorm(n)
z <- z_complete
z[seq(3L, n, by = 7L)] <- NA_real_

analysis_source <- data.frame(
  y = y,
  x = x,
  z = z,
  weight = runif(n, 0.5, 2),
  stratum = stratum,
  psu = psu
)

imputation_data <- analysis_source[c("z", "x", "y")]
initializer <- mice::mice(imputation_data, m = 1, maxit = 0, printFlag = FALSE)
method <- initializer$method
method[] <- ""
method["z"] <- "pmm"
predictor_matrix <- initializer$predictorMatrix
predictor_matrix[,] <- 0
predictor_matrix["z", c("x", "y")] <- 1

imputed <- mice::mice(
  imputation_data,
  m = 5,
  maxit = 5,
  seed = 20260921,
  method = method,
  predictorMatrix = predictor_matrix,
  printFlag = FALSE
)

models <- lapply(seq_len(imputed$m), function(index) {
  completed <- mice::complete(imputed, index)
  model_data <- analysis_source
  model_data$z <- completed$z
  stopifnot(!anyNA(model_data$z))
  design <- survey::svydesign(
    ids = ~psu,
    strata = ~stratum,
    weights = ~weight,
    nest = TRUE,
    data = model_data
  )
  survey::svyglm(y ~ x + z, design = design)
})

pooled <- mitools::MIcombine(models)
pooled_coefficients <- stats::coef(pooled)
pooled_variance <- stats::vcov(pooled)

stopifnot(
  length(models) == 5L,
  all(c("(Intercept)", "x", "z") %in% names(pooled_coefficients)),
  all(is.finite(pooled_coefficients)),
  all(is.finite(pooled_variance)),
  pooled_variance["x", "x"] > 0
)

message("multiple-imputation survey runtime smoke test passed")
