#!/usr/bin/env python3
"""Exports one region's Overture places as GeoJSONSeq for tippecanoe (see build-all.sh).

  python3 -I build.py --bbox w,s,e,n --prominent cats.json --out places.geojsonseq
                      (--release 2026-09-23.0 | --input 'local/*.parquet')

Reads Overture's public GeoParquet (anonymous S3, CDLA-Permissive-2.0; Foursquare rows Apache-2.0)
with DuckDB, keeps places that are not closed and that Overture is reasonably sure exist, and writes
the same properties as Overture's own places PMTiles (`@name`, basic_category, confidence, phones...),
so the app reads both the same way. Adds `name_he` (Hebrew name when known) and a per-feature
minzoom: well-known kinds of places appear earlier than offices and services.
"""
import argparse
import json
import sys

import duckdb

MIN_CONFIDENCE = 0.4

p = argparse.ArgumentParser()
p.add_argument('--bbox', required=True)
p.add_argument('--prominent', required=True, help='JSON file: categories shown from zoom 14')
p.add_argument('--out', required=True)
g = p.add_mutually_exclusive_group(required=True)
g.add_argument('--release', help='Overture release, e.g. 2026-09-23.0')
g.add_argument('--input', help='parquet path or glob (tests)')
a = p.parse_args()

w, s, e, n = (float(x) for x in a.bbox.split(','))
prominent = json.load(open(a.prominent))

con = duckdb.connect()
if a.release:
    con.execute("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';")
    src = f"s3://overturemaps-us-west-2/release/{a.release}/theme=places/type=place/*.parquet"
else:
    src = a.input
con.execute(f"CREATE VIEW raw AS SELECT * FROM read_parquet('{src}', hive_partitioning = false)")
cols = {r[0] for r in con.execute('DESCRIBE raw').fetchall()}


def col(name: str, expr: str, default: str = 'NULL') -> str:
    return expr if name in cols else default


# basic_category is newer than categories.primary; prefer it when the release has it.
category = 'coalesce(basic_category, categories.primary)' if 'basic_category' in cols else 'categories.primary'
status = col('operating_status', 'operating_status')
sql = f"""
  SELECT
    id,
    names.primary AS name,
    map_extract_value(names.common, 'he') AS name_he,
    {category} AS category,
    confidence::DOUBLE AS confidence,
    {status} AS operating_status,
    {col('phones', 'phones')} AS phones,
    {col('websites', 'websites')} AS websites,
    {col('socials', 'socials')} AS socials,
    {col('emails', 'emails')} AS emails,
    {col('brand', 'brand')} AS brand,
    {col('addresses', 'addresses')} AS addresses,
    -- Places are points: their bbox is the point (no spatial extension needed).
    bbox.xmin::DOUBLE AS lng,
    bbox.ymin::DOUBLE AS lat
  FROM raw
  WHERE bbox.xmin BETWEEN {w} AND {e} AND bbox.ymin BETWEEN {s} AND {n}
    AND names.primary IS NOT NULL
    AND coalesce(confidence, 0) >= {MIN_CONFIDENCE}
    AND coalesce({status}, 'open') <> 'permanently_closed'
"""

prom = set(prominent)
count = 0
kinds: dict[str, int] = {}
with open(a.out, 'w', encoding='utf-8') as f:
    rows = con.execute(sql)
    names = [d[0] for d in rows.description]
    while batch := rows.fetchmany(10000):
        for r in batch:
            row = dict(zip(names, r))
            cat, conf = row['category'], row['confidence'] or 0
            props = {'id': row['id'], '@name': row['name_he'] or row['name'], 'confidence': round(conf, 2)}
            if row['name_he'] and row['name_he'] != row['name']:
                props['name'] = row['name']
            if cat:
                props['basic_category'] = cat
            if row['operating_status'] and row['operating_status'] != 'open':
                props['operating_status'] = row['operating_status']
            for k in ('phones', 'websites', 'socials', 'emails'):
                if row[k]:
                    props[k] = json.dumps(row[k], ensure_ascii=False)
            if row['brand'] and (row['brand'].get('names') or {}).get('primary'):
                props['brand'] = json.dumps({'names': {'primary': row['brand']['names']['primary']}}, ensure_ascii=False)
            if row['addresses']:
                ad = [{k: v for k, v in x.items() if v and k in ('freeform', 'locality', 'postcode')} for x in row['addresses'][:1]]
                props['addresses'] = json.dumps(ad, ensure_ascii=False)
            # Well-known places that Overture is sure about first, then the other well-known kinds,
            # then offices and services (the map's own layers add their own zoom limits on top).
            minzoom = 13 if cat in prom and conf >= 0.7 else 14 if cat in prom else 15
            f.write(json.dumps({
                'type': 'Feature',
                'tippecanoe': {'minzoom': minzoom},
                'properties': props,
                'geometry': {'type': 'Point', 'coordinates': [round(row['lng'], 6), round(row['lat'], 6)]},
            }, ensure_ascii=False, default=str))
            f.write('\n')
            count += 1
            kinds[cat or '-'] = kinds.get(cat or '-', 0) + 1
print(f'{count} places; columns: {"basic_category" if "basic_category" in cols else "categories.primary"}', file=sys.stderr)
print('top categories:', ', '.join(f'{k} {v}' for k, v in sorted(kinds.items(), key=lambda x: -x[1])[:25]), file=sys.stderr)
if count == 0:
    sys.exit('no places: wrong release or bbox?')
