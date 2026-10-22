"""Refresh the public K-apt bulletin attachment; no account is used."""
import json
import re
from pathlib import Path
from datetime import date
import requests
import openpyxl

cache = Path('.data-cache')
cache.mkdir(exist_ok=True)
session = requests.Session()
base = 'https://www.k-apt.go.kr'
page = session.get(base + '/web/board/webReference/boardList.do', timeout=60)
page.raise_for_status()
token = re.search(r'name="_csrf" value="([^"]+)"', page.text)[1]
listing = session.post(base + '/web/board/webReference/boardListAjax.do', data={
    '_csrf': token, 'pageNo': '1', 'boardType': '03', 'scode': '01'}, timeout=60)
listing.raise_for_status()
seq = re.search(r"goCheck\((\d+), 0\)", listing.text)[1]
source_date = re.search(r'(20\d{2})[.-](\d{2})[.-](\d{2})', listing.text)
if not source_date:
    raise ValueError('Missing K-apt source date')
source_date = '-'.join(source_date.groups())
view = session.post(base + '/web/board/webReference/boardView.do', data={
    '_csrf': token, 'seq': seq, 'boardSecret': '0', 'boardType': '03'}, timeout=60)
view.raise_for_status()
token = re.search(r'name="_csrf" value="([^"]+)"', view.text)[1]
form = dict(re.findall(r'<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"', view.text))
response = session.post(base + '/web/board/webReference/fileListData.do?seq=BOARD_FILE', json=form,
    headers={'Referer': view.url, 'X-CSRF-TOKEN': token, 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest'}, timeout=60)
response.raise_for_status()
files = response.json()['data']
if len(files) != 1 or not files[0]['fileName'].endswith('.xlsx'):
    raise ValueError('Unexpected K-apt attachment')
f = files[0]
response = session.get(base + '/cmm/file/BOARD/fileDownload.do', params={'key': f['seq'], 'fileName': f['fileName']}, timeout=120)
response.raise_for_status()
if not response.content.startswith(b'PK'):
    raise ValueError('Invalid workbook')
path = cache / 'kapt-basic.xlsx'
path.write_bytes(response.content)
sheet = openpyxl.load_workbook(path, read_only=True, data_only=True).active
sheet.reset_dimensions()
rows = iter(sheet.values)
next(rows)
headers = next(rows)
required = ['시도', '시군구', '동리', '단지코드', '단지명', '법정동주소', '도로명주소', '사용승인일', '세대수']
if any(k not in headers for k in required):
    raise ValueError('Workbook columns changed')
result = {}
for values in rows:
    r = dict(zip(headers, values))
    if r.get('시도') != '서울특별시':
        continue
    address = r.get('법정동주소') or ''
    dong = r.get('동리') or ''
    matches = list(re.finditer(re.escape(dong) + r'\s+(산\s*)?(\d+)(?:-(\d+))?(?:-|\s|,|$)', address)) if dong else []
    parcels = sorted(set(('산' if m[1] else '') + str(int(m[2])) + ('-' + str(int(m[3])) if m[3] and int(m[3]) else '') for m in matches))
    year = str(r.get('사용승인일') or '')
    record = {'kaptCode': r['단지코드'], 'kaptName': r['단지명'], 'gu': r['시군구'], 'dong': dong,
        'jibun': parcels[0] if parcels else None, 'parcels': parcels, 'address': r.get('도로명주소'), 'buildYearMonth': year[:4] + '.' + year[4:6] if re.fullmatch(r'\d{8}', year) else None,
        'householdCount': int(float(r.get('세대수') or 0)) or None}
    old = result.get(record['kaptCode'])
    if old:
        if any(old[k] != record[k] for k in ['gu', 'dong', 'householdCount', 'buildYearMonth']):
            raise ValueError('Conflicting K-apt records')
        old['parcels'] = sorted(set(old['parcels'] + parcels))
    else:
        result[record['kaptCode']] = record
result = list(result.values())
if len(result) < 3000:
    raise ValueError('Incomplete or duplicate K-apt data')
(cache / 'kapt-seoul.json').write_text(json.dumps({'sourceDate': source_date, 'retrievedAt': date.today().isoformat(), 'source': base + '/web/board/webReference/boardList.do', 'rows': result}, ensure_ascii=False), encoding='utf-8')
print(json.dumps({'complexes': len(result), 'parcels': sum(bool(r['jibun']) for r in result), 'sourceDate': source_date}))
