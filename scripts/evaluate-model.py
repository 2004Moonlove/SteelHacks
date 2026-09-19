#!/usr/bin/env python3
"""Opt-in live evaluation via the local backend. Never reads or prints API keys."""
import argparse
import copy
import json
import time
import urllib.error
import urllib.request
from pathlib import Path

CASES = [
    {
        'id': 'gym_zh',
        'description': '我在比较同一家健身房的年卡和月卡。年卡1200元人民币，月卡150元人民币，两种都不限次数，服务相同且无其他费用。我计划用4个月，每月8次，每次60分钟。我首先考虑总支出，预算最多1300元。',
        'check': 'Known CNY prices, 4 months, 8 visits per month, total-cost preference; no invented extras.',
    },
    {
        'id': 'housing_hard_zh',
        'description': '两套房选哪套？A每月1300美元，B每月1100美元。我必须能带猫，并且单程通勤不能超过30分钟。A单程10分钟，B40分钟。两套都还不知道是否允许养猫。我要住6个月。请不要猜押金或其他费用。',
        'check': 'Keep pet permission unknown and both explicit hard requirements; no invented deposit.',
    },
    {
        'id': 'generic_course_zh',
        'description': '我想选陶艺课或者木工课，也可以这学期先不选。我想做出一个可以带回家的作品，但还不知道学费或具体上课时间。周六上午必须有空照顾家人。请帮我列出需要比较的因素。',
        'check': 'Generic comparison with 3 relevant options, Saturday availability, unknown price/time.',
    },
]


def post(base, path, body):
    req = urllib.request.Request(base + path, data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'}, method='POST')
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req, timeout=190) as response:
        return json.load(response)


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def check_decision(case, value):
    require(value.get('schemaVersion') == 2 and value.get('mode') == 'live', 'Expected a live v2 decision')
    require(value.get('originalInput') == case['description'], 'Original input must be preserved')
    require(2 <= len(value.get('options', [])) <= 6, 'Expected 2–6 options')
    require(len(value.get('questions', [])) <= 3, 'Too many clarification questions')
    if case['id'] == 'gym_zh':
        require(value['currency'] == 'CNY', 'Chinese yuan currency was lost')
        require(value['template'] == 'subscription', 'Known gym scenario did not select the subscription template')
        require(value['context']['months']['value'] == 4, 'Explicit 4-month horizon was lost')
        require(value['context']['usesPerMonth']['value'] == 8, 'Explicit frequency was lost')
        amounts = {(c['cadence'], c['amount']['value']) for o in value['options'] for c in o['costs']}
        require(('annual', 120000) in amounts and ('monthly', 15000) in amounts, 'Actual payment cadence/prices were not preserved')
        primary = next((f for f in value['factors'] if f['id'] == value['primaryFactorId']), None)
        require(primary is not None and primary.get('ruleId') == 'total_cost', 'Explicit cost preference must use a dynamic verified total-cost rule')
        require(value['context']['budgetCents']['value'] == 130000, 'Explicit budget was lost')
        require(not any(f.get('ruleId') == 'total_cost' and f['purpose'] == 'hard' and f['target'].get('max') == 130000 for f in value['factors']), 'Duplicate stored budget threshold would become stale on common-budget edits')
        require(all(o['minutesPerMonth']['value'] is None for o in value['options']), 'Unknown extra monthly overhead was invented or double-counted')
        require(all(o['minutesPerUse']['value'] == 60 for o in value['options']), 'Explicit per-use time was lost')
    if case['id'] == 'housing_hard_zh':
        hard = [f for f in value['factors'] if f['purpose'] == 'hard' and f['origin'] == 'user']
        require(len(hard) >= 2, 'Explicit hard constraints were omitted')
        require(all(f.get('userQuote') and f['userQuote'] in case['description'] for f in hard), 'Hard requirement lost original evidence')
        require(any(any(v['value'] is None for v in f['values'].values()) for f in hard), 'Unknown permission was converted to a fact')
    if case['id'] == 'generic_course_zh':
        require(value['template'] == 'general', 'Unknown scenario forced into a paid-plan template')
        require(len(value['options']) >= 3, 'Explicit defer option was lost')
        require(all(not o['costsComplete'] for o in value['options']), 'Unstated costs were assumed complete')
        require(all(c['amount']['value'] is None for o in value['options'] for c in o['costs']), 'An unknown course/defer cost was fabricated')
        require(all(v['value'] is None for f in value['factors'] if f['dataType'] == 'money' for v in f['values'].values()), 'An unknown money factor was invented')
        hard = [f for f in value['factors'] if f['purpose'] == 'hard' and f['origin'] == 'user']
        require(any('周六' in f.get('userQuote', '') for f in hard), 'Explicit Saturday hard condition was lost')
        require(all('周六' in f.get('userQuote', '') for f in hard), 'A stated wish was incorrectly upgraded to a hard requirement')
        require(all(v['value'] is None for f in value['factors'] if f['dataType'] == 'boolean' for v in f['values'].values()), 'A desired outcome or defer choice was misattributed as a known option fact')


def followups(base, output, decision_file=None, selected=None):
    """Re-use a real generated gym response and test quoted material analysis."""
    fixture = Path(decision_file) if decision_file else output / 'gym_zh.json'
    if not fixture.exists():
        raise ValueError('Run --case gym_zh first; follow-ups need its actual response.')
    decision = json.loads(fixture.read_text())
    first = next(o for o in decision['options'] if any(c['cadence'] == 'annual' for c in o['costs']))
    second = next(o for o in decision['options'] if any(c['cadence'] == 'monthly' for c in o['costs']))
    ad = {'id': 'live-ad', 'title': 'Sales message', 'text': 'Last day! Everyone is joining. Annual membership costs CNY 1200. Cancel anytime and get your unused months refunded.'}
    terms = {'id': 'live-terms', 'title': 'Service terms', 'text': 'The annual membership costs CNY 1200, paid in full for 12 months. Cancellation and refunds are not permitted during the 12-month term.'}
    monthly = {'id': 'live-monthly', 'title': 'Monthly terms', 'text': 'The monthly membership costs CNY 150 per month. No other fees. Cancel at least 24 hours before the next renewal; the current month is non-refundable.'}
    steps = [('no_materials', [], [], first['id']), ('single_material', [ad], [], first['id']), ('conflicting_materials', [ad, terms], [], first['id']), ('separate_option_material', [ad, terms], [monthly], second['id'])]
    rows = []
    for name, first_materials, second_materials, option_id in steps:
        if selected and name not in selected:
            continue
        current = copy.deepcopy(decision)
        for option in current['options']:
            option['materials'] = first_materials if option['id'] == first['id'] else second_materials if option['id'] == second['id'] else []
        started = time.monotonic()
        row = {'case': name}
        try:
            response = post(base, '/api/choices/materials', {'decision': current, 'optionId': option_id})
            (output / (name + '.json')).write_text(json.dumps(response, ensure_ascii=False, indent=2))
            require(response['decisionId'] == current['id'] and response['decisionVersion'] == current['version'], 'Version binding mismatch')
            require(response['optionId'] == option_id, 'Option attribution mismatch')
            provided = next(o['materials'] for o in current['options'] if o['id'] == option_id)
            for finding in response['findings']:
                require(all(any(m['id'] == q['materialId'] and q['quote'] in m['text'] for m in provided) for q in finding['quotes']), 'Unverifiable quote')
            if name == 'no_materials':
                require(response['status'] == 'no_materials' and not response['findings'], 'Missing materials were scored')
            if name == 'single_material':
                require(any('urgency' in f['labels'] for f in response['findings']), 'The explicit Last day deadline was not identified')
            if name == 'conflicting_materials':
                require(response['status'] == 'inconsistent', 'Explicit refund conflict was not found')
            row.update(status='passed_automated_checks', analysis_status=response['status'], findings=len(response['findings']))
        except urllib.error.HTTPError as exc:
            payload = json.load(exc)
            row.update(status='api_error', http=exc.code, code=payload.get('code'), message=payload.get('message'), issues=payload.get('issues'))
        except Exception as exc:
            row.update(status='failed', reason=str(exc))
        row['elapsed_seconds'] = round(time.monotonic() - started, 1)
        rows.append(row)
        print(json.dumps(row, ensure_ascii=False), flush=True)
        (output / 'followups-report.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2))
    started = time.monotonic()
    if selected and 'natural_language_factor' not in selected:
        (output / 'followups-report.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2))
        return rows
    row = {'case': 'natural_language_factor'}
    try:
        response = post(base, '/api/choices/factors', {'decision': decision, 'instruction': '再加一个硬性条件：我必须能在下个月离开这个城市时取消会员。具体退出规则还不知道，不要猜。'})
        (output / 'natural_language_factor.json').write_text(json.dumps(response, ensure_ascii=False, indent=2))
        require(response['decisionId'] == decision['id'] and response['decisionVersion'] == decision['version'], 'Version binding mismatch')
        require(not any(f['id'] in {x['id'] for x in decision['factors']} for f in response['factors']), 'Suggested factor overwrote an existing ID')
        require(bool(response['factors'] or response['questions']), 'No actionable factors or clarifications returned')
        row.update(status='passed_automated_checks', factors=len(response['factors']))
    except urllib.error.HTTPError as exc:
        payload = json.load(exc)
        row.update(status='api_error', http=exc.code, code=payload.get('code'), issues=payload.get('issues'))
    except Exception as exc:
        row.update(status='failed', reason=str(exc))
    row['elapsed_seconds'] = round(time.monotonic() - started, 1)
    rows.append(row)
    print(json.dumps(row, ensure_ascii=False), flush=True)
    (output / 'followups-report.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2))
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', default='http://127.0.0.1:8081')
    parser.add_argument('--output-dir', default='/tmp/clear-choice-model-eval')
    parser.add_argument('--case', choices=[c['id'] for c in CASES])
    parser.add_argument('--decision-file', help='Explicit decision JSON for follow-ups; may be a labeled fictional fixture')
    parser.add_argument('--follow-ups', action='store_true', help='Use the saved real gym response to test materials and factor suggestions')
    parser.add_argument('--live', action='store_true', help='Explicitly allow real model API calls through the local backend')
    parser.add_argument('--follow-up-case', action='append', choices=['no_materials', 'single_material', 'conflicting_materials', 'separate_option_material', 'natural_language_factor'], help='With --follow-ups, run only these checks; repeat to select several')
    args = parser.parse_args()
    if not args.live:
        parser.error('Pass --live to make real API requests. Offline tests use deterministic stubs.')
    output = Path(args.output_dir)
    output.mkdir(parents=True, exist_ok=True)
    if args.follow_ups:
        rows = followups(args.base_url, output, args.decision_file, args.follow_up_case)
        raise SystemExit(0 if all(r['status'] == 'passed_automated_checks' for r in rows) else 1)
    rows = []
    for case in CASES:
        if args.case and args.case != case['id']:
            continue
        started = time.monotonic()
        row = {'case': case['id'], 'expected_review': case['check']}
        try:
            decision = post(args.base_url, '/api/choices/generate', {'description': case['description']})
            (output / (case['id'] + '.json')).write_text(json.dumps(decision, ensure_ascii=False, indent=2))
            check_decision(case, decision)
            row.update(status='passed_automated_checks', options=len(decision['options']), factors=len(decision['factors']))
        except urllib.error.HTTPError as exc:
            try:
                payload = json.load(exc)
                row.update(status='api_error', http=exc.code, code=payload.get('code'), message=payload.get('message'), issues=payload.get('issues'))
            except (ValueError, OSError):
                row.update(status='api_error', http=exc.code)
        except Exception as exc:
            row.update(status='failed', reason=str(exc))
        row['elapsed_seconds'] = round(time.monotonic() - started, 1)
        rows.append(row)
        print(json.dumps(row, ensure_ascii=False), flush=True)
        (output / 'report.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2))
    raise SystemExit(0 if all(r['status'] == 'passed_automated_checks' for r in rows) else 1)


if __name__ == '__main__':
    main()
