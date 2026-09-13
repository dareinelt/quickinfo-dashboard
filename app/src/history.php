<?php
declare(strict_types=1);

/**
 * Zeitreihen für die Detail-Ansicht: kombiniert Rohdaten und 10-Minuten-Aggregate
 * und liefert je Metrik [[ts, value], …] im gewünschten Raster.
 */

function qb_history_build(int $nodeId, string $range, ?array $metricFilter = null): array
{
    $spec = QB_RANGES[$range];
    $step = $spec['step'];
    $now = time();
    $to = (int)(floor($now / 60) * 60) + 60;
    $from = (int)(floor(($to - $spec['seconds']) / $step) * $step);

    $db = qb_db();
    $series = [];

    $rawRetentionFrom = $now - qb_config()['retention']['raw_days'] * 86400;
    $aggUntil = (int)qb_meta_get('agg_until', '0');

    $filterSql = '';
    $filterParams = [];
    if ($metricFilter) {
        $filterSql = ' AND metric IN (' . implode(',', array_fill(0, count($metricFilter), '?')) . ')';
        $filterParams = array_values($metricFilter);
    }

    // 1) Aggregate verwenden, wenn der Zeitraum über die Rohdaten-Retention hinausgeht
    //    oder das Raster ohnehin grob ist.
    $rawFrom = $from;
    if ($from < $rawRetentionFrom || $step >= QB_AGG_BUCKET) {
        $aggEnd = min($to, $aggUntil);
        if ($aggEnd > $from) {
            $stmt = $db->prepare(
                'SELECT metric, FLOOR(ts / ?) * ? AS bucket, SUM(avg_value * samples) / SUM(samples) AS v
                   FROM node_metrics_agg
                  WHERE node_id = ? AND ts >= ? AND ts < ?' . $filterSql . '
               GROUP BY metric, bucket
               ORDER BY metric, bucket'
            );
            $stmt->execute([$step, $step, $nodeId, $from, $aggEnd, ...$filterParams]);
            foreach ($stmt as $row) {
                $series[$row['metric']][(int)$row['bucket']] = round((float)$row['v'], 3);
            }
            $rawFrom = max($from, $aggEnd);
        }
    }

    // 2) Rohdaten, gebucketet auf das Raster
    $stmt = $db->prepare(
        'SELECT metric, FLOOR(ts / ?) * ? AS bucket, AVG(value) AS v
           FROM node_metrics
          WHERE node_id = ? AND ts >= ? AND ts < ?' . $filterSql . '
       GROUP BY metric, bucket
       ORDER BY metric, bucket'
    );
    $stmt->execute([$step, $step, $nodeId, $rawFrom, $to, ...$filterParams]);
    foreach ($stmt as $row) {
        $series[$row['metric']][(int)$row['bucket']] = round((float)$row['v'], 3);
    }

    $out = [];
    foreach ($series as $metric => $points) {
        ksort($points);
        $list = [];
        foreach ($points as $ts => $v) {
            $list[] = [$ts, $v];
        }
        $out[$metric] = $list;
    }
    ksort($out, SORT_NATURAL);

    return [
        'range'  => $range,
        'from'   => $from,
        'to'     => $to,
        'step'   => $step,
        'now'    => $now,
        'series' => $out,
    ];
}
