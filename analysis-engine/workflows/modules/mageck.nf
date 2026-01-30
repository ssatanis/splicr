/*
 * MAGeCK analysis processes
 */

process MAGECK_COUNT {
    tag "${analysis_id}"
    publishDir "${params.outdir}/mageck", mode: params.publish_dir_mode
    
    input:
    path(fastq_files)
    val(library_file)
    val(s3_bucket)
    
    output:
    path("counts.count.txt"), emit: count_file
    path("counts.count_normalized.txt"), emit: normalized
    path("counts.countsummary.txt"), emit: summary
    
    script:
    """
    mageck count \
        -l ${library_file} \
        -n counts \
        --fastq ${fastq_files} \
        --norm-method median \
        --pdf-report \
        --output-prefix counts
    """
}

process MAGECK_TEST {
    tag "${analysis_id}"
    publishDir "${params.outdir}/mageck", mode: params.publish_dir_mode
    
    input:
    path(count_file)
    val(treatment_samples)
    val(control_samples)
    val(analysis_id)
    
    output:
    path("results.gene_summary.txt"), emit: gene_summary
    path("results.sgrna_summary.txt"), emit: sgrna_summary
    path("results*"), emit: results
    
    script:
    """
    mageck test \
        -k ${count_file} \
        -t ${treatment_samples} \
        -c ${control_samples} \
        -n results \
        --pdf-report \
        --gene-test-fdr-threshold 0.05
    """
}
