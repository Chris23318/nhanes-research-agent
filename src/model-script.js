function safe(value) { if (!/^[A-Z][A-Z0-9_]{0,39}$/.test(value)) throw new Error('unsafe variable in model specification'); return value; }
function safeInternal(value) { if (!/^cov_[1-9][0-9]*$/.test(value)) throw new Error('unsafe internal variable in advanced analysis plan'); return value; }
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
  const family = spec.outcomeFamily === 'binary' ? 'quasibinomial()' : spec.outcomeFamily === 'count' ? 'quasipoisson(link="log")' : 'gaussian()';
  const ratioEffect = ['binary','count'].includes(spec.outcomeFamily);
  const effectType = spec.outcomeFamily === 'binary' ? 'odds_ratio' : spec.outcomeFamily === 'count' ? 'rate_ratio' : 'beta';
  const analysisMode = spec.schemaVersion === '1.7' ? 'generic_survey_v7' : spec.schemaVersion === '1.6' ? 'generic_survey_v6' : spec.schemaVersion === '1.5' ? 'generic_survey_v5' : 'generic_survey_v4';
  const resultSchema = spec.schemaVersion === '1.7' ? '2.6' : spec.schemaVersion === '1.6' ? '2.5' : spec.schemaVersion === '1.5' ? '2.4' : '2.3';
  const advanced=spec.advancedAnalysisPlan||{nonlinear:{method:'none'},subgroups:[]};
  const nonlinear=advanced.nonlinear?.method==='restricted_cubic_spline';
  const splineDf=Number(advanced.nonlinear?.df||4);
  const subgroupPlans=Array.isArray(advanced.subgroups)?advanced.subgroups:[];
  const imputation=spec.missingDataPolicy?.strategy==='multiple_imputation'?spec.missingDataPolicy.imputation:null;
  const miRequested=Boolean(imputation),miCovariates=covariates.map(x=>x.name);
  const nonlinearCode=nonlinear?[
    `spline_model <- svyglm(analysis_outcome ~ splines::ns(analysis_exposure,df=${splineDf})${covariates.length?' + '+covariates.map(x=>x.name).join(' + '):''},design=design,family=${family})`,
    'nonlinear_comparison <- tryCatch(anova(model,spline_model,method="Wald",force=TRUE),error=function(e) NULL)',
    'nonlinear_p <- if (is.null(nonlinear_comparison)) NA_real_ else { values <- unlist(nonlinear_comparison); candidate <- as.numeric(values[grepl("p",names(values),ignore.case=TRUE)]); candidate <- candidate[is.finite(candidate)&candidate>=0&candidate<=1]; if(length(candidate)) candidate[[1]] else NA_real_ }',
    `nonlinear_result <- list(method="restricted_cubic_spline",df=${splineDf},comparison="linear_vs_spline_survey_wald",p_value=nonlinear_p,converged=isTRUE(spline_model$converged))`
  ]:['spline_model <- NULL','nonlinear_result <- list(method="none",df=NULL,comparison=NULL,p_value=NULL,converged=NULL)'];
  const subgroupCode=subgroupPlans.flatMap((plan,index)=>{
    const variable=safeInternal(plan.variable),minimum=Number(plan.minimumUnweightedN||30),adjusters=covariates.map(x=>x.name).filter(name=>name!==variable),subFormula=`analysis_outcome ~ analysis_exposure${adjusters.length?' + '+adjusters.join(' + '):''}`,interactionFormula=`analysis_outcome ~ analysis_exposure * ${variable}${adjusters.length?' + '+adjusters.join(' + '):''}`;
    return [
      `subgroup_name <- "${variable}"`,
      `subgroup_concept <- ${JSON.stringify(String(plan.concept))}`,
      `subgroup_levels <- levels(droplevels(analytic[[subgroup_name]]))`,
      `interaction_p <- tryCatch({ interaction_model <- svyglm(${interactionFormula},design=design,family=${family}); test <- regTermTest(interaction_model,~analysis_exposure:${variable},method="Wald"); as.numeric(test$p) },error=function(e) NA_real_)`,
      'for (level_value in subgroup_levels) {',
      `  keep <- as.character(design$variables[[subgroup_name]]) == level_value; subgroup_n <- sum(keep,na.rm=TRUE); if (subgroup_n < ${minimum}) next`,
      '  subgroup_design <- design[keep,]; if (degf(subgroup_design)<=0) next',
      `  subgroup_model <- tryCatch(svyglm(${subFormula},design=subgroup_design,family=${family}),error=function(e) NULL); if (is.null(subgroup_model)) next`,
      `  subgroup_row <- extract_exposure(subgroup_model,paste0("subgroup_${index+1}")); subgroup_row$subgroup <- subgroup_concept; subgroup_row$level <- level_value; subgroup_row$unweighted_n <- subgroup_n; subgroup_row$interaction_p <- interaction_p; subgroup_rows[[length(subgroup_rows)+1]] <- subgroup_row`,
      '}'
    ];
  });
  const imputationCode=miRequested?[
    `mi_covariates <- c(${miCovariates.map(name=>`"${name}"`).join(',')})`,
    `imputation_diagnostics <- list(requested=TRUE,executed=FALSE,role="sensitivity_analysis",method="mice_chained_equations",m=${imputation.m},maxit=${imputation.maxit},seed=${imputation.seed},imputedVariables=mi_covariates,outcomeImputed=FALSE,exposureImputed=FALSE,pooling="rubin_rules_mitools",eligibleN=0,completeCaseN=nrow(analytic),imputedCellCount=0,loggedEventCount=0,reason=NULL)`,
    `mi_core <- c("analysis_outcome","analysis_exposure","analysis_weight","${safe(spec.strataVariable)}","${safe(spec.psuVariable)}")`,
    'mi_core_observed <- population_eligible & design_valid & complete.cases(analysis_source[,mi_core,drop=FALSE]) & is.finite(analysis_source$analysis_outcome) & is.finite(analysis_source$analysis_exposure)',
    'mi_indices <- which(mi_core_observed); mi_full_source <- analysis_source[design_valid,,drop=FALSE]; mi_full_source$.source_row <- which(design_valid); mi_full_source$.mi_domain <- mi_full_source$.source_row %in% mi_indices',
    'mi_data <- droplevels(analysis_source[mi_indices,unique(c(mi_core,mi_covariates)),drop=FALSE])',
    'imputation_diagnostics$eligibleN <- nrow(mi_data)',
    'if (nrow(mi_data)<30) stop("Fewer than 30 observations are eligible for multiple imputation")',
    'mi_missing <- sum(is.na(mi_data[,mi_covariates,drop=FALSE]))',
    'imputation_diagnostics$imputedCellCount <- mi_missing',
    'if (mi_missing>0) {',
    '  mi_method <- mice::make.method(mi_data); mi_method[] <- ""',
    '  for (name in mi_covariates) { if (!anyNA(mi_data[[name]])) next; if (is.factor(mi_data[[name]])) { observed_levels <- nlevels(droplevels(mi_data[[name]])); if (observed_levels<2) stop(paste("Imputation factor has fewer than two observed levels:",name)); mi_method[[name]] <- if (observed_levels==2) "logreg" else "polyreg" } else { if (length(unique(mi_data[[name]][is.finite(mi_data[[name]])]))<2) stop(paste("Imputation variable has insufficient variation:",name)); mi_method[[name]] <- "pmm" } }',
    '  mi_predictors <- mice::make.predictorMatrix(mi_data); mi_predictors[mi_method=="",] <- 0; diag(mi_predictors) <- 0',
    `  mi_fit <- mice::mice(mi_data,m=${imputation.m},maxit=${imputation.maxit},method=mi_method,predictorMatrix=mi_predictors,seed=${imputation.seed},printFlag=FALSE)`,
    `  mi_models <- lapply(seq_len(${imputation.m}),function(index) { completed <- mice::complete(mi_fit,index); completed$.source_row <- mi_indices; completed_full <- mi_full_source; completed_match <- match(completed_full$.source_row,completed$.source_row); matched <- !is.na(completed_match); for(name in mi_covariates) completed_full[[name]][matched] <- completed[[name]][completed_match[matched]]; completed_full_design <- svydesign(ids=~${safe(spec.psuVariable)},strata=~${safe(spec.strataVariable)},weights=~analysis_weight,nest=TRUE,data=completed_full); completed_design <- subset(completed_full_design,.mi_domain); completed_design$variables <- droplevels(completed_design$variables); if (nrow(completed_design$variables)!=nrow(completed) || degf(completed_design)<=0) stop("Imputed survey domain is invalid"); svyglm(${formula},design=completed_design,family=${family}) })`,
    '  mi_pool <- mitools::MIcombine(mi_models); mi_term <- "analysis_exposure"',
    '  if (!(mi_term %in% names(mi_pool$coefficients))) stop("Pooled multiple-imputation model has no exposure coefficient")',
    '  mi_estimate <- as.numeric(mi_pool$coefficients[[mi_term]]); mi_se <- sqrt(as.numeric(mi_pool$variance[mi_term,mi_term])); mi_df <- as.numeric(mi_pool$df[[mi_term]]); if (!is.finite(mi_df) || mi_df<=0) mi_df <- Inf; mi_critical <- if(is.finite(mi_df)) qt(0.975,mi_df) else qnorm(0.975); mi_low <- mi_estimate-mi_critical*mi_se; mi_high <- mi_estimate+mi_critical*mi_se; mi_p <- if(is.finite(mi_df)) 2*pt(abs(mi_estimate/mi_se),df=mi_df,lower.tail=FALSE) else 2*pnorm(abs(mi_estimate/mi_se),lower.tail=FALSE)',
    '  mi_row <- data.frame(model="multiple_imputation",term=mi_term,estimate=mi_estimate,std_error=mi_se,p_value=mi_p,ci_low=mi_low,ci_high=mi_high)',
    ratioEffect ? `  mi_row$effect <- exp(mi_row$estimate); mi_row$ci_low <- exp(mi_row$ci_low); mi_row$ci_high <- exp(mi_row$ci_high); mi_row$effect_type <- "${effectType}"` : '  mi_row$effect <- mi_row$estimate; mi_row$effect_type <- "beta"',
    '  sensitivity_result <- bind_rows(sensitivity_result,mi_row)',
    '  imputation_diagnostics$executed <- TRUE; imputation_diagnostics$loggedEventCount <- if(is.null(mi_fit$loggedEvents)) 0 else nrow(mi_fit$loggedEvents); imputation_diagnostics$fractionMissingInformation <- if(!is.null(mi_pool$missinfo) && mi_term %in% names(mi_pool$missinfo)) as.numeric(mi_pool$missinfo[[mi_term]]) else NULL',
    '} else { imputation_diagnostics$reason <- "no_missing_covariate_values" }'
  ]:['imputation_diagnostics <- list(requested=FALSE,executed=FALSE,role=NULL,method=NULL,m=NULL,maxit=NULL,seed=NULL,imputedVariables=list(),outcomeImputed=FALSE,exposureImputed=FALSE,pooling=NULL,eligibleN=NULL,completeCaseN=nrow(analytic),imputedCellCount=0,loggedEventCount=0,reason="not_requested")'];
  return [
    '# Generated from an approved model specification. Review artifacts before interpretation.',
    `suppressPackageStartupMessages({ library(survey); library(dplyr); library(jsonlite)${miRequested?'; library(mice); library(mitools)':''} })`, 'options(survey.lonely.psu="adjust")',
    'args <- commandArgs(trailingOnly=TRUE)', 'if (length(args)<2) stop("Usage: Rscript model.R MERGED_RDS OUTPUT_DIR")',
    'analytic <- readRDS(args[[1]])', 'assembled_n <- nrow(analytic)', 'output_dir <- args[[2]]', 'dir.create(output_dir,recursive=TRUE,showWarnings=FALSE)',
    'if (!("RIDAGEYR" %in% names(analytic))) stop("RIDAGEYR is required for the approved population restriction")',
    `population_eligible <- is.finite(as.numeric(analytic[["RIDAGEYR"]])) & as.numeric(analytic[["RIDAGEYR"]]) >= ${spec.population.ageMin}`,
    'population_n <- sum(population_eligible)', 'if (population_n<30) stop("Fewer than 30 population-eligible observations")',
    `analytic$analysis_exposure <- ${exposure}`, `analytic$analysis_outcome <- ${outcome}`,
    ...outcomeTransform,
    ...covariates.map(x=>`analytic$${x.name} <- ${x.encoding==='factor'?`factor(${cycleExpression(x.mappings)})`:`as.numeric(${cycleExpression(x.mappings)})`}`),
    ...exposureTransform,
    `analytic$analysis_weight <- as.numeric(analytic[["${safe(spec.weightVariable)}"]]) / ${weightDivisor}`,
    `required <- c("analysis_outcome","analysis_exposure","analysis_weight","${safe(spec.strataVariable)}","${safe(spec.psuVariable)}"${covariates.map(x=>`,"${x.name}"`).join('')})`,
    'missing_row <- function(name) { value <- analytic[[name]][population_eligible]; missing <- is.na(value); if (is.numeric(value)) missing <- missing | !is.finite(value); data.frame(variable=name,missing_n=sum(missing),missing_pct=100*mean(missing)) }',
    'missingness_result <- bind_rows(lapply(required,missing_row))',
    'finite_numeric <- is.finite(analytic$analysis_outcome) & is.finite(analytic$analysis_exposure) & is.finite(analytic$analysis_weight)',
    ...covariates.filter(x=>x.encoding==='continuous').map(x=>`finite_numeric <- finite_numeric & is.finite(analytic$${x.name})`),
    'complete <- population_eligible & complete.cases(analytic[,required,drop=FALSE]) & finite_numeric & analytic$analysis_weight > 0',
    `design_required <- c("analysis_weight","${safe(spec.strataVariable)}","${safe(spec.psuVariable)}")`,
    'design_valid <- complete.cases(analytic[,design_required,drop=FALSE]) & is.finite(analytic$analysis_weight) & analytic$analysis_weight > 0',
    'analytic$.analysis_domain <- complete',
    'flow <- data.frame(stage=c("assembled","population_eligible","complete_case"),n=c(assembled_n,population_n,sum(complete)))',
    'complete_case_diagnostics <- list(populationN=population_n,completeN=sum(complete),retention=as.numeric(sum(complete)/population_n))',
    'analysis_source <- analytic',
    'design_source <- droplevels(analytic[design_valid,,drop=FALSE])', 'if (nrow(design_source)<30) stop("Fewer than 30 observations with valid survey design fields")',
    `full_design <- svydesign(ids=~${safe(spec.psuVariable)},strata=~${safe(spec.strataVariable)},weights=~analysis_weight,nest=TRUE,data=design_source)`,
    'design <- subset(full_design,.analysis_domain)', 'design$variables <- droplevels(design$variables)', 'analytic <- design$variables',
    'if (nrow(analytic)<30 || nrow(analytic)!=sum(complete)) stop("Fewer than 30 complete observations or survey domain count mismatch")',
    'if (degf(design)<=0) stop("Survey design degrees of freedom are not positive")',
    ...(spec.outcomeFamily === 'binary' ? ['if (length(unique(analytic$analysis_outcome)) != 2) stop("Binary outcome must contain both classes")'] : []),
    ...(spec.outcomeFamily === 'count' ? ['if (any(analytic$analysis_outcome < 0) || any(abs(analytic$analysis_outcome-round(analytic$analysis_outcome)) > 1e-8)) stop("Count outcome must contain nonnegative integers")'] : []),
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
    'model_diagnostics <- list(converged=isTRUE(model$converged),rank=as.numeric(model$rank),parameters=length(est),residualDf=as.numeric(df.residual(model)),conditionNumber=condition_number,dispersion=as.numeric(summary(model)$dispersion))',
    'coefficient_result <- data.frame(term=names(est),estimate=as.numeric(est),std_error=as.numeric(tab[,2]),p_value=as.numeric(tab[,4]),ci_low=as.numeric(ci[,1]),ci_high=as.numeric(ci[,2]))',
    ratioEffect ? `coefficient_result$effect <- exp(coefficient_result$estimate); coefficient_result$ci_low <- exp(coefficient_result$ci_low); coefficient_result$ci_high <- exp(coefficient_result$ci_high); coefficient_result$effect_type <- "${effectType}"` : 'coefficient_result$effect <- coefficient_result$estimate; coefficient_result$effect_type <- "beta"',
    'extract_exposure <- function(fitted,label) {',
    '  estimates <- coef(fitted); intervals <- confint(fitted); table <- summary(fitted)$coefficients',
    '  if (!("analysis_exposure" %in% names(estimates))) stop(paste(label,"has no exposure coefficient"))',
    '  row <- data.frame(model=label,term="analysis_exposure",estimate=as.numeric(estimates[["analysis_exposure"]]),std_error=as.numeric(table["analysis_exposure",2]),p_value=as.numeric(table["analysis_exposure",4]),ci_low=as.numeric(intervals["analysis_exposure",1]),ci_high=as.numeric(intervals["analysis_exposure",2]))',
    ratioEffect ? `  row$effect <- exp(row$estimate); row$ci_low <- exp(row$ci_low); row$ci_high <- exp(row$ci_high); row$effect_type <- "${effectType}"` : '  row$effect <- row$estimate; row$effect_type <- "beta"',
    '  row', '}',
    `unadjusted_model <- svyglm(analysis_outcome ~ analysis_exposure,design=design,family=${family})`,
    'weight_limits <- as.numeric(quantile(analytic$analysis_weight,probs=c(0.01,0.99),na.rm=TRUE,names=FALSE,type=8))',
    'if (length(weight_limits)!=2 || any(!is.finite(weight_limits)) || weight_limits[1]<=0 || weight_limits[1]>weight_limits[2]) stop("Weight trimming limits are invalid")',
    'trimmed_source <- full_design$variables',
    'trimmed_source$analysis_weight <- pmin(pmax(trimmed_source$analysis_weight,weight_limits[1]),weight_limits[2])',
    `trimmed_full_design <- svydesign(ids=~${safe(spec.psuVariable)},strata=~${safe(spec.strataVariable)},weights=~analysis_weight,nest=TRUE,data=trimmed_source)`,
    'trimmed_design <- subset(trimmed_full_design,.analysis_domain)', 'trimmed_design$variables <- droplevels(trimmed_design$variables)',
    `trimmed_model <- svyglm(${formula},design=trimmed_design,family=${family})`,
    'sensitivity_result <- bind_rows(extract_exposure(unadjusted_model,"unadjusted"),extract_exposure(trimmed_model,"weight_trim_1_99"))',
    'if (any(!is.finite(as.matrix(sensitivity_result[c("effect","ci_low","ci_high","p_value")]))) ) stop("Nonfinite sensitivity result")',
    ...imputationCode,
    ...nonlinearCode,
    'subgroup_rows <- list()',
    ...subgroupCode,
    'subgroup_result <- if(length(subgroup_rows)) bind_rows(subgroup_rows) else data.frame()',
    'weight_quantiles <- as.numeric(quantile(analytic$analysis_weight,probs=c(0,0.01,0.5,0.99,1),na.rm=TRUE,names=FALSE,type=8))',
    `design_diagnostics <- list(degreesFreedom=as.numeric(degf(design)),strata=length(unique(analytic[["${safe(spec.strataVariable)}"]])),psu=length(unique(interaction(analytic[["${safe(spec.strataVariable)}"]],analytic[["${safe(spec.psuVariable)}"]],drop=TRUE))))`,
    'domain_diagnostics <- list(method="survey_subset",fullDesignN=nrow(full_design$variables),populationEligibleN=population_n,analyticDomainN=nrow(analytic),excludedInvalidDesignN=assembled_n-nrow(full_design$variables))',
    'weight_diagnostics <- list(min=weight_quantiles[1],p01=weight_quantiles[2],median=weight_quantiles[3],p99=weight_quantiles[4],max=weight_quantiles[5],positive=sum(analytic$analysis_weight>0),trimmed=sum(analytic$analysis_weight<weight_limits[1] | analytic$analysis_weight>weight_limits[2]))',
    'imputation_diagnostics_table <- data.frame(metric=c("requested","executed","role","method","m","maxit","seed","eligibleN","completeCaseN","imputedCellCount","loggedEventCount","fractionMissingInformation","reason"),value=vapply(c("requested","executed","role","method","m","maxit","seed","eligibleN","completeCaseN","imputedCellCount","loggedEventCount","fractionMissingInformation","reason"),function(name) { value <- imputation_diagnostics[[name]]; if(is.null(value)) "" else paste(value,collapse=";") },character(1)))',
    'write.csv(flow,file.path(output_dir,"model-sample-flow.csv"),row.names=FALSE)', 'write.csv(missingness_result,file.path(output_dir,"missingness-diagnostics.csv"),row.names=FALSE)', 'write.csv(imputation_diagnostics_table,file.path(output_dir,"imputation-diagnostics.csv"),row.names=FALSE)', 'write.csv(descriptive_result,file.path(output_dir,"descriptive-statistics.csv"),row.names=FALSE)', 'write.csv(coefficient_result,file.path(output_dir,"model-coefficients.csv"),row.names=FALSE)', 'write.csv(sensitivity_result,file.path(output_dir,"sensitivity-coefficients.csv"),row.names=FALSE)', 'write.csv(subgroup_result,file.path(output_dir,"subgroup-results.csv"),row.names=FALSE)',
    `runtime <- list(rVersion=R.version.string,surveyVersion=as.character(packageVersion("survey")),havenVersion=as.character(packageVersion("haven"))${miRequested?',miceVersion=as.character(packageVersion("mice")),mitoolsVersion=as.character(packageVersion("mitools"))':''},completedAt=format(Sys.time(),tz="UTC",usetz=TRUE))`,
    `result_document <- list(schemaVersion="${resultSchema}",status="completed",analysisMode="${analysisMode}",analysis="survey-weighted ${spec.outcomeFamily} regression",outcomeFamily="${spec.outcomeFamily}",exposureUnit="${spec.exposureTransform}",cycles=c(${spec.cycles.map(cycleLiteral).join(',')}),weightRule="${weightRule}",weightDiagnostics=weight_diagnostics,designDiagnostics=design_diagnostics,domainDiagnostics=domain_diagnostics,missingnessDiagnostics=missingness_result,completeCaseDiagnostics=complete_case_diagnostics,imputationDiagnostics=imputation_diagnostics,modelDiagnostics=model_diagnostics,descriptiveStatistics=descriptive_result,advancedAnalysisPlan=list(nonlinearMethod="${nonlinear?'restricted_cubic_spline':'none'}",splineDf=${nonlinear?splineDf:'NULL'},subgroupCount=${subgroupPlans.length}),nonlinearAnalysis=nonlinear_result,subgroupAnalyses=subgroup_result,flow=list(merged=assembled_n,population_eligible=population_n,analytic_complete_case=nrow(analytic)${spec.outcomeFamily === 'binary' ? ',outcome_cases=sum(analytic$analysis_outcome==1)' : ''}),coefficients=coefficient_result,sensitivityCoefficients=sensitivity_result,sensitivityPlan=c("unadjusted","weight_trim_1_99"${miRequested?',"multiple_imputation"':''}),warnings=c("Cross-sectional association; causal interpretation is not supported.","${miRequested?'Primary model uses complete cases; covariate-only multiple imputation is a prespecified sensitivity analysis and does not impute exposure or outcome.':'Primary model uses complete cases; variable-level missingness and retention are reported, but multiple imputation was not executed.'}","Subgroup and nonlinear analyses are secondary; interaction P values are exploratory and unadjusted for multiplicity.","Pregnancy restriction was not applied unless encoded in the approved population definition."),modelSpecDigest="${spec.digest}",runtime=runtime)`,
    'write_json(result_document,file.path(output_dir,"result.json"),auto_unbox=TRUE,pretty=TRUE,digits=NA,na="null")',
    'saveRDS(list(model=model,unadjusted_model=unadjusted_model,trimmed_model=trimmed_model,spec_digest="'+spec.digest+'",session=sessionInfo()),file.path(output_dir,"model.rds"))'
  ].join('\n');
}
module.exports = { generateModelScript };
