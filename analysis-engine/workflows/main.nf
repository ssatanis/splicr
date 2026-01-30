#!/usr/bin/env nextflow

/*
 * SplicR Main Workflow
 * Orchestrates MAGeCK, BAGEL2, DrugZ analysis and visualization
 */

nextflow.enable.dsl=2

// Import modules
include { PREPROCESSING } from './modules/preprocessing'
include { MAGECK_COUNT } from './modules/mageck'
include { MAGECK_TEST } from './modules/mageck'
include { BAGEL2 } from './modules/bagel2'
include { DRUGZ } from './modules/drugz'
include { VISUALIZATION } from './modules/visualization'

// Default parameters
params.analysis_id = null
params.file_keys = null
params.s3_bucket = null
params.library = null
params.treatment = null
params.control = null
params.algorithm = 'mageck'  // mageck, bagel2, drugz, or all
params.outdir = "s3://${params.s3_bucket}/results/${params.analysis_id}"

// Validate required parameters
if (!params.analysis_id) {
    error "Missing required parameter: --analysis_id"
}
if (!params.file_keys) {
    error "Missing required parameter: --file_keys"
}
if (!params.s3_bucket) {
    error "Missing required parameter: --s3_bucket"
}

// Main workflow
workflow {
    log.info """
    ========================================
    SplicR CRISPR Screen Analysis Pipeline
    ========================================
    Analysis ID    : ${params.analysis_id}
    S3 Bucket      : ${params.s3_bucket}
    Algorithm      : ${params.algorithm}
    Files          : ${params.file_keys}
    Treatment      : ${params.treatment}
    Control        : ${params.control}
    ========================================
    """.stripIndent()

    // Create input channel
    file_keys_ch = Channel.from(params.file_keys.split(','))
    
    // Preprocessing
    PREPROCESSING(
        file_keys_ch,
        params.s3_bucket,
        params.analysis_id
    )
    
    // Run selected algorithm(s)
    if (params.algorithm == 'mageck' || params.algorithm == 'all') {
        MAGECK_COUNT(
            PREPROCESSING.out.fastq_files,
            params.library,
            params.s3_bucket
        )
        
        MAGECK_TEST(
            MAGECK_COUNT.out.count_file,
            params.treatment,
            params.control,
            params.analysis_id
        )
        
        results_ch = MAGECK_TEST.out.results
    }
    
    if (params.algorithm == 'bagel2' || params.algorithm == 'all') {
        BAGEL2(
            MAGECK_COUNT.out.count_file,
            params.treatment,
            params.control,
            params.analysis_id,
            params.s3_bucket
        )
        
        results_ch = results_ch.mix(BAGEL2.out.results)
    }
    
    if (params.algorithm == 'drugz' || params.algorithm == 'all') {
        DRUGZ(
            MAGECK_COUNT.out.count_file,
            params.treatment,
            params.control,
            params.analysis_id,
            params.s3_bucket
        )
        
        results_ch = results_ch.mix(DRUGZ.out.results)
    }
    
    // Generate visualizations
    VISUALIZATION(
        results_ch,
        params.algorithm,
        params.analysis_id,
        params.s3_bucket
    )
    
    // Emit completion event
    VISUALIZATION.out.figures.view { 
        log.info "Analysis complete! Figures generated."
    }
}

workflow.onComplete {
    log.info """
    ========================================
    Pipeline completed at: ${new Date()}
    Success              : ${workflow.success}
    Duration             : ${workflow.duration}
    Results directory    : ${params.outdir}
    ========================================
    """.stripIndent()
}

workflow.onError {
    log.error """
    ========================================
    Pipeline failed!
    Error message: ${workflow.errorMessage}
    ========================================
    """.stripIndent()
}
