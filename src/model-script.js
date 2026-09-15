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
  const covariates = spec.covariates.map((item,index)=>({name:`cov_${index+1}`,variable:safe(item.variable),encoding:item.encoding}));
  const formula = `analysis_outcome ~ ${['analysis_exposure',...covariates.map(x=>x.name)].join(' + ')}`;
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
    ...covariates.map(x=>`analytic$${x.name} <- ${x.encoding==='factor'?`factor(analytic[["${x.variable}"]])`:`as.numeric(analytic[["${x.variable}"]])`}`),
    ...exposureTransform,
    `analytic$analysis_weight <- as.numeric(analytic[["${safe(spec.weightVariable)}"]]) / ${spec.cycles.length}`,
    `required <- c("analysis_outcome","analysis_exposure","analysis_weight","${safe(spec.strataVariable)}","${safe(spec.psuVariable)}"${covariates.map(x=>`,"${x.name}"`).join('')})`,
    'finite_numeric <- is.finite(analytic$analysis_outcome) & is.finite(analytic$analysis_exposure) & is.finite(analytic$analysis_weight)',
    ...covariates.filter(x=>x.encoding==='continuous').map(x=>`finite_numeric <- finite_numeric & is.finite(analytic$${x.name})`),
    'complete <- complete.cases(analytic[,required,drop=FALSE]) & finite_numeric & analytic$analysis_weight > 0',
    'flow <- data.frame(stage=c("assembled","population_eligible","complete_case"),n=c(assembled_n,population_n,sum(complete)))',
    'analytic <- analytic[complete,,drop=FALSE]', 'if (nrow(analytic)<30) stop("Fewer than 30 complete observations")',
    `design <- svydesign(ids=~${safe(spec.psuVariable)},strata=~${safe(spec.strataVariable)},weights=~analysis_weight,nest=TRUE,data=analytic)`,
    'if (degf(design)<=0) stop("Survey design degrees of freedom are not positive")',
    ...(spec.outcomeFamily === 'binary' ? ['if (length(unique(analytic$analysis_outcome)) != 2) stop("Binary outcome must contain both classes")'] : []),
    `model <- svyglm(${formula},design=design,family=${family})`,
    'est <- coef(model); ci <- confint(model); tab <- summary(model)$coefficients',
    'if (any(!is.finite(est)) || any(!is.finite(ci))) stop("Nonfinite model result")',
    'coefficient_result <- data.frame(term=names(est),estimate=as.numeric(est),std_error=as.numeric(tab[,2]),p_value=as.numeric(tab[,4]),ci_low=as.numeric(ci[,1]),ci_high=as.numeric(ci[,2]))',
    spec.outcomeFamily === 'binary' ? 'coefficient_result$effect <- exp(coefficient_result$estimate); coefficient_result$ci_low <- exp(coefficient_result$ci_low); coefficient_result$ci_high <- exp(coefficient_result$ci_high); coefficient_result$effect_type <- "odds_ratio"' : 'coefficient_result$effect <- coefficient_result$estimate; coefficient_result$effect_type <- "beta"',
    'write.csv(flow,file.path(output_dir,"model-sample-flow.csv"),row.names=FALSE)', 'write.csv(coefficient_result,file.path(output_dir,"model-coefficients.csv"),row.names=FALSE)',
    'runtime <- list(rVersion=R.version.string,surveyVersion=as.character(packageVersion("survey")),havenVersion=as.character(packageVersion("haven")),completedAt=format(Sys.time(),tz="UTC",usetz=TRUE))',
    `result_document <- list(schemaVersion="2.0",status="completed",analysisMode="generic_survey_v1",analysis="survey-weighted ${spec.outcomeFamily} regression",exposureUnit="${spec.exposureTransform}",cycles=c(${spec.cycles.map(cycleLiteral).join(',')}),weightRule="${safe(spec.weightVariable)} / ${spec.cycles.length}",flow=list(merged=assembled_n,population_eligible=population_n,analytic_complete_case=nrow(analytic)${spec.outcomeFamily === 'binary' ? ',outcome_cases=sum(analytic$analysis_outcome==1)' : ''}),coefficients=coefficient_result,sensitivityCoefficients=list(),warnings=c("Cross-sectional association; causal interpretation is not supported.","Complete-case primary model; missing-data sensitivity analysis was not executed.","Pregnancy restriction was not applied unless encoded in the approved population definition."),modelSpecDigest="${spec.digest}",runtime=runtime)`,
    'write_json(result_document,file.path(output_dir,"result.json"),auto_unbox=TRUE,pretty=TRUE,digits=NA,na="null")',
    'saveRDS(list(model=model,spec_digest="'+spec.digest+'",session=sessionInfo()),file.path(output_dir,"model.rds"))'
  ].join('\n');
}
module.exports = { generateModelScript };
