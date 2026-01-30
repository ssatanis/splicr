/*
 * DrugZ analysis process
 */

process DRUGZ {
    tag "${analysis_id}"
    publishDir "${params.outdir}/drugz", mode: params.publish_dir_mode
    
    input:
    path(count_file)
    val(treatment_cols)
    val(control_cols)
    val(analysis_id)
    val(s3_bucket)
    
    output:
    path("drugz_output.txt"), emit: drugz_results
    path("drugz_output*"), emit: results
    
    script:
    """
    python3 /drugz/drugz.py \
        -i ${count_file} \
        -o drugz_output.txt \
        -c ${control_cols} \
        -x ${treatment_cols} \
        --remove_genes NO_CURRENT \
        --half_window_size 500 \
        --pseudocount 5
    """
}
