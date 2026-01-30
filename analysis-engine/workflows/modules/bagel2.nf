/*
 * BAGEL2 analysis process
 */

process BAGEL2 {
    tag "${analysis_id}"
    publishDir "${params.outdir}/bagel2", mode: params.publish_dir_mode
    
    input:
    path(count_file)
    val(treatment_cols)
    val(control_cols)
    val(analysis_id)
    val(s3_bucket)
    
    output:
    path("bagel_output.bf"), emit: bayes_factors
    path("fold_changes.txt"), emit: fold_changes
    path("bagel_output*"), emit: results
    
    script:
    """
    python3 /bagel2/BAGEL.py fc \
        -i fold_changes.txt \
        -o bagel_output \
        -e /bagel2/CEGv2.txt \
        -n /bagel2/NEGv1.txt \
        -c 1,2
    """
}
