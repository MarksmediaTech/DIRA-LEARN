#!/usr/bin/env python3
"""Content checks for the V13 curriculum source (curriculum/v13/*.yaml): required subjects from the V13 brief, Kenyan context,
the 16 lesson elements, and repetition across sessions and tracks. Usage: python3 -I tools/curriculum/coverage.py <project>"""
import sys, os, re, yaml, itertools, collections
proj = sys.argv[1]; src = os.path.join(proj, 'curriculum', 'v13')
FILES = {'core': 'core.yaml', 'digital': 'digital_marketing.yaml', 'ai': 'ai_tools.yaml', 'content': 'content_creation.yaml', 'entrepreneurship': 'entrepreneurship.yaml'}
data = {k: yaml.safe_load(open(os.path.join(src, f), encoding='utf8')) for k, f in FILES.items()}

def text_of(x):
    if isinstance(x, dict): return ' '.join(text_of(v) for v in x.values())
    if isinstance(x, list): return ' '.join(text_of(v) for v in x)
    return str(x)
def taught(track):  # what a track actually teaches: topics, subtopics, segment titles and steps
    return ' '.join(text_of([s['topics'], s['segments']]) for s in data[track]['sessions']).lower()

# Required subjects from the brief: each is a list of alternative phrases (any one must appear in the taught content).
REQ = {
 'digital': {'Introduction to digital marketing': ['what digital marketing is', 'digital marketing foundations'], 'Channels and strategies': ['channels and strategies'],
   'Digital footprint and online reputation': ['digital footprint'], 'Personal and business online presence': ['online presence'], 'Social media marketing': ['social media marketing'],
   'Facebook': ['facebook'], 'Instagram': ['instagram'], 'TikTok': ['tiktok'], 'LinkedIn': ['linkedin'], 'WhatsApp Business': ['whatsapp business'],
   'Target audiences and personas': ['persona'], 'Content planning and calendars': ['content calendar'], 'Marketing graphics and visual communication': ['graphic'],
   'Copywriting and persuasive messaging': ['copywriting'], 'Branding and brand identity': ['brand identity'], 'SEO fundamentals': ['search engine optimisation', 'seo'],
   'Online advertising': ['advertising'], 'Campaign planning and budgeting': ['budget'], 'Marketing analytics': ['analytics'],
   'Customer engagement and conversion': ['conversion'], 'Campaign development and presentation': ['campaign']},
 'ai': {'Understanding AI': ['what ai is', 'understanding ai'], 'Types and uses of AI tools': ['types of ai tools', 'kinds of ai tools', 'types and uses'], 'Responsible and ethical AI use': ['responsible', 'ethic'],
   'Prompt engineering': ['prompt engineering'], 'AI for research and learning': ['research'], 'AI-assisted writing': ['writing'], 'AI images and creative work': ['image'],
   'AI for presentations': ['presentation'], 'Productivity and everyday tasks': ['productivity'], 'AI-assisted business activities': ['business'], 'Introduction to automation': ['automation'],
   'Fact-checking and evaluating outputs': ['fact-check', 'fact check'], 'Privacy': ['privacy'], 'Bias': ['bias'], 'Limitations': ['limitation']},
 'content': {'Content strategy and planning': ['content strategy'], 'Storytelling': ['storytelling'], 'Smartphone photography': ['photography'], 'Mobile video production': ['mobile video'],
   'Lighting and composition': ['lighting', 'composition'], 'Video editing': ['video editing', 'editing'], 'Audio and sound': ['audio', 'sound'], 'Graphic design fundamentals': ['graphic design'],
   'Visual storytelling': ['visual storytelling'], 'Platform formats': ['format'], 'Captions and creative writing': ['caption', 'creative writing'], 'Branding and consistency': ['consisten'],
   'Copyright and responsible use': ['copyright'], 'Portfolio development': ['portfolio']},
 'entrepreneurship': {'Identifying opportunities': ['opportunit'], 'Customer problems': ['customer problem', 'problem'], 'Market research': ['market research'], 'Target markets': ['target market'],
   'Value propositions': ['value proposition'], 'Business models': ['business model'], 'Business planning': ['business plan'], 'Financial literacy': ['financial literacy'],
   'Pricing and costing': ['pricing', 'costing'], 'Revenue and expenses': ['revenue', 'expense'], 'Cash flow': ['cash flow', 'cash-flow'], 'Branding and marketing a small business': ['branding', 'marketing'],
   'Customer service and experience': ['customer service', 'customer experience'], 'Sales and negotiation': ['negotiat'], 'Testing ideas': ['test'], 'Pitching': ['pitch']},
}
WIDER = {'Personal branding': ['personal brand'], 'Professional online presence': ['professional online', 'online presence', 'linkedin'], 'Pitching yourself': ['pitch yourself', 'elevator pitch', 'introduce yourself', 'self-introduction', 'personal pitch'],
   'Communication and self-presentation': ['communication', 'self-presentation', 'present yourself'], 'Confidence at work': ['confidence'], 'Professional behaviour and workplace readiness': ['workplace', 'professional behaviour', 'professionalism']}
ELEMENTS = ['title', 'purpose', 'objectives', 'topics', 'segments', 'demonstrations', 'guided_exercises', 'individual_activities', 'group_activities', 'examples', 'tools', 'assessment', 'expected_outputs', 'facilitator', 'homework']
KENYA = re.compile(r"\b(kenya\w*|kes|ksh|m-pesa|mpesa|nairobi|mombasa|kisumu|nakuru|eldoret|thika|ruiru|kibera|kawangware|githurai|kitengela|county|matatu|boda|mama mboga|jua kali|safaricom|kra|huduma|swahili|sheng|jumia|kilimall|ajira|hustler fund|youth enterprise|uwezo|murang'a|nyeri|kilifi|kisii|machakos|kakamega|meru|embu|kiambu|kajiado|narok|garissa|malindi|naivasha|wakulima|gikomba|eastleigh|westlands|kitui|kericho|busia|bungoma|lamu|turkana|rongai|juja|limuru|nanyuki|voi|form four|kcse|tvet|chama|harambee|mitumba)\b", re.I)

problems, notes = [], []
for tr, req in REQ.items():
    t = taught(tr)
    for subject, alts in req.items():
        if not any(a in t for a in alts): problems.append(f'{tr}: required subject not found in taught content: {subject}')
allt = ' '.join(taught(k) for k in data)
for subject, alts in WIDER.items():
    hits = [k for k in data if any(a in taught(k) for a in alts)]
    if not hits: problems.append(f'wider curriculum: not covered: {subject}')
    else: notes.append(f'wider: {subject}: {", ".join(hits)}')
for tr, d in data.items():
    for s in d['sessions']:
        sid = f"{tr} S{s['session_no']}"
        for e in ELEMENTS:
            if not s.get(e): problems.append(f'{sid}: element empty or missing: {e}')
        if not s.get('cross_track_notes') and tr != 'core': notes.append(f'{sid}: no cross-track note')
        k = len(KENYA.findall(text_of(s)))
        if k < 3: problems.append(f'{sid}: only {k} Kenyan context references')
        if sum(x['minutes'] for x in s['segments']) != s['duration']: problems.append(f'{sid}: segments do not add up')
        for x in s['segments']:
            if not x.get('steps'): problems.append(f"{sid}: segment without teaching steps: {x['title']}")
# repetition: identical long sentences in two different sessions (the standard stretch-break segment is the same on purpose)
sent = collections.defaultdict(set)
for tr, d in data.items():
    for s in d['sessions']:
        # facilitator logistics (room set-up, programme rules) are deliberately the same in every track; teaching content must not be
        for m in re.split(r'(?<=[.!?])\s+', text_of({k: (v if k != 'segments' else [g for g in v if g['kind'] != 'break']) for k, v in s.items() if k != 'facilitator'})):
            m = m.strip().lower()
            if len(m.split()) >= 12: sent[m].add(f"{tr} S{s['session_no']}")
dups = {m: v for m, v in sent.items() if len(v) > 1}
for m, v in list(dups.items())[:15]: problems.append(f'repeated sentence in {sorted(v)}: "{m[:90]}..."')
# ---- V13.1 review refinements (19 Nov 2026) ----
def sess(tr, n): return next(x for x in data[tr]['sessions'] if x['session_no'] == n)
c1 = text_of(sess('core', 1)).lower()
for bad in ['who the safeguarding lead is', 'has appointed', 'appointed officers only', 'names of the appointed']:
    if bad in c1: problems.append(f'refinement 1: core S1 still implies appointed safeguarding officers ("{bad}")')
if 'formally confirmed' not in c1: problems.append('refinement 1: core S1 does not say to share only formally confirmed contacts')
for tr in ('digital', 'ai', 'content', 'entrepreneurship'):
    if 'privacy option' not in data[tr]['project'].lower(): problems.append(f'refinement 2: {tr} final project has no privacy option')
    for n in (3, 5, 7):
        if not any('consent and privacy' in x.lower() for x in sess(tr, n)['facilitator'].get('inclusion_and_safeguarding', [])):
            problems.append(f'refinement 2: {tr} S{n} has no consent and privacy instruction')
    s8 = sess(tr, 8); pres = [g for g in s8['segments'] if g['kind'] == 'assessment']
    if sum(g['minutes'] for g in pres) != 60 or len(pres) != 2: problems.append(f'refinement 3: {tr} S8 presentation time is not two 30-minute blocks')
    if not any(x.startswith('Session 8 room plan') for x in s8['facilitator'].get('delivery', [])): problems.append(f'refinement 3: {tr} S8 has no room plan')
    if not any('recording' in h for h in sess(tr, 7)['homework']): problems.append(f'refinement 3: {tr} S7 has no recorded-presentation homework')
    for n in range(3, 9):
        b = [g for g in sess(tr, n)['segments'] if g['kind'] == 'break']
        segs = sess(tr, n)['segments']
        if len(b) != 1 or b[0]['minutes'] != 5 or segs[0]['kind'] == 'break' or segs[-1]['kind'] == 'break': problems.append(f'breaks: {tr} S{n} needs exactly one 5-minute break inside the session')
for n in (1, 2):
    if any(g['kind'] == 'break' for g in sess('core', n)['segments']): problems.append(f'breaks: core S{n} should keep its approved flow')
fin = text_of(sess('entrepreneurship', 5)).lower()
for need in ['variable cost per unit', 'contribution per unit = price - variable cost per unit', 'gross profit = revenue - cost of goods sold',
             'fully allocated unit cost = variable cost per unit + (fixed costs', 'break-even (units) = fixed costs / contribution per unit', 'kes 63']:
    if need not in fin: problems.append(f'refinement 4: E&B S5 is missing "{need}"')
for bad in ['gross profit per bottle = price minus variable cost', 'unit cost plus a margin', 'never price below unit cost']:
    if bad in fin: problems.append(f'refinement 4: E&B S5 still has the inconsistent "{bad}"')
for tr in ('ai', 'content'):
    for n in range(3, 9):
        x = sess(tr, n)
        if not any(re.search(r'(?i)free|low-cost|low-data|low data', t) for t in x['tools']): problems.append(f'refinement 5: {tr} S{n} tools list has no free, low-cost or low-data option')
        if not any(t.lower().startswith('shared devices and low data') for t in x['facilitator'].get('inclusion_and_safeguarding', [])): problems.append(f'refinement 5: {tr} S{n} has no shared-device arrangement')

# ---- final review refinements (19 Nov 2026, second round) ----
ai4 = text_of(sess('ai', 4)).lower()
for need in ['duck.ai', 'without an account', 'chatgpt', 'gemini', 'copilot', 'perplexity', 'no learner is required to create an ai account']:
    if need not in ai4: problems.append(f'final review: AI Tools S4 does not mention "{need}"')
cc = text_of(data['content']).lower()
for sent_ in re.split(r'(?<=[.!?])\s+', cc):
    if ('anyone with the link' in sent_ or 'unlisted' in sent_) and not re.search(r'\b(never|not|change any)\b', sent_):
        problems.append(f'final review: Content Creation allows an open link: "{sent_[:90]}"')
if 'restricted-access link' not in data['content']['project'].lower(): problems.append('final review: Content Creation project does not require restricted-access portfolio submissions')
for n in (7, 8):
    if 'restricted-access' not in text_of(sess('content', n)).lower(): problems.append(f'final review: Content Creation S{n} does not say how to submit with restricted access')

words = sum(len(text_of(s).split()) for d in data.values() for s in d['sessions'])
print(f'curriculum content: {sum(len(d["sessions"]) for d in data.values())} sessions, about {words} words, {len(dups)} repeated long sentences')
for n in notes: print('  note:', n)
for p in problems: print('  PROBLEM:', p)
print(f'content check: {len(problems)} problems'); sys.exit(1 if problems else 0)
