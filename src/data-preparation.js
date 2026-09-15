function rString(value) {
  const text = String(value);
  if (!/^[A-Za-z0-9_.:/-]+$/.test(text)) throw new Error('unsafe value in data preparation specification');
  return `"${text}"`;
}

function generatePreparationScript(manifest, cleaning) {
  const files = manifest.files || [];
  if (!files.length) return '# No approved data files.\nstop("No approved data files")\n';
  const rows = files.map(file => {
    if (!/^\d{4}-\d{4}$/.test(file.cycle) || !/^[A-Z][A-Z0-9_]{1,40}$/.test(file.code)) throw new Error('unsafe file in data manifest');
    return `  tibble(cycle=${rString(file.cycle)}, file=${rString(file.code)}, path=file.path(cache_dir, paste0(${rString(file.code)}, ".XPT")))`;
  });
  const cleanable = (cleaning.rules || []).map(rule => `${rule.file}:${rule.cycle}`);
  return [
    '# Generated data assembly. It does not fit a statistical model.',
    'suppressPackageStartupMessages({ library(haven); library(dplyr); library(purrr); library(tibble) })',
    'args <- commandArgs(trailingOnly=TRUE)',
    'if (length(args) < 2) stop("Usage: Rscript prepare-data.R CACHE_DIR OUTPUT_DIR")',
    'cache_dir <- normalizePath(args[[1]], mustWork=TRUE)',
    'output_dir <- args[[2]]',
    'dir.create(output_dir, recursive=TRUE, showWarnings=FALSE)',
    'source("cleaning-draft.R", local=TRUE)',
    `approved_digest <- ${rString(cleaning.digest)}`,
    `cleanable <- c(${cleanable.map(rString).join(', ')})`,
    'files <- bind_rows(', rows.join(',\n'), ')',
    'if (anyDuplicated(files[c("cycle","file")])) stop("Duplicate file manifest entry")',
    'if (!all(file.exists(files$path))) stop("One or more approved XPT files are missing")',
    'audits <- list()',
    'components <- pmap(files, function(cycle, file, path) {',
    '  data <- read_xpt(path)',
    '  if (!("SEQN" %in% names(data))) stop(paste(file, "has no SEQN"))',
    '  if (anyDuplicated(data$SEQN)) stop(paste(file, "has duplicate SEQN"))',
    '  key <- paste(file, cycle, sep=":")',
    '  if (key %in% cleanable) {',
    '    cleaned <- clean_component(data, file, cycle, approved_digest)',
    '    data <- cleaned$data; audits[[key]] <<- cleaned$audit',
    '  } else audits[[key]] <<- list(rows=nrow(data), note="No approved recode rule; values unchanged")',
    '  data', '})',
    'files$data <- components',
    'merged_cycles <- map(unique(files$cycle), function(selected_cycle) {',
    '  pieces <- files$data[files$cycle == selected_cycle]',
    '  merge_one <- function(left, right) {',
    '    if (anyDuplicated(left$SEQN) || anyDuplicated(right$SEQN)) stop("SEQN is not unique before join")',
    '    joined <- full_join(left, right, by="SEQN")',
    '    if (anyDuplicated(joined$SEQN)) stop("Join produced duplicate SEQN")',
    '    joined', '  }',
    '  merged <- reduce(pieces, merge_one)',
    '  merged$.nhanes_cycle <- selected_cycle',
    '  merged', '})',
    'merged <- bind_rows(merged_cycles)',
    'if (anyDuplicated(paste(merged$SEQN, merged$.nhanes_cycle, sep=":"))) stop("Duplicate participant-cycle after merge")',
    'saveRDS(merged, file.path(output_dir, "merged.rds"))',
    'write.csv(tibble(stage=c("component_rows","merged_rows"), n=c(sum(map_int(components,nrow)),nrow(merged))), file.path(output_dir,"sample-flow.csv"), row.names=FALSE)',
    'saveRDS(audits, file.path(output_dir,"cleaning-audit.rds"))',
    'writeLines(capture.output(sessionInfo()), file.path(output_dir,"session-info.txt"))'
  ].join('\n');
}

module.exports = { generatePreparationScript };
