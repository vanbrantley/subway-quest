{% macro reapply_min_n_suppression() %}
    {% set suppressed_tables = ['mart_station_stats', 'mart_station_pairs', 'mart_line_stats', 'mart_quest_completion'] %}
    {% for table in suppressed_tables %}
        {% set policy_sql %}
            CREATE OR REPLACE ROW ACCESS POLICY min_n_suppression
            ON `{{ target.project }}.{{ target.dataset }}_mart.{{ table }}`
            GRANT TO ('serviceAccount:powerbi-reader@{{ target.project }}.iam.gserviceaccount.com')
            FILTER USING (segment_user_count >= 5)
        {% endset %}
        {% do run_query(policy_sql) %}
    {% endfor %}
{% endmacro %}