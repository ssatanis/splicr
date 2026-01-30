/*
 * Visualization module
 */

process VISUALIZATION {
    tag "${analysis_id}"
    publishDir "${params.outdir}/figures", mode: params.publish_dir_mode
    
    input:
    path(results)
    val(algorithm)
    val(analysis_id)
    val(s3_bucket)
    
    output:
    path("*.png"), emit: figures_png
    path("*.pdf"), emit: figures_pdf
    path("qc_metrics.json"), emit: qc_metrics, optional: true
    path("*"), emit: figures
    
    script:
    """
    python3 /analysis/generate_figures.py \
        --analysis-id ${analysis_id} \
        --s3-bucket ${s3_bucket} \
        --algorithm ${algorithm} \
        --results-dir \${PWD} \
        --output-dir \${PWD}
    """
}
