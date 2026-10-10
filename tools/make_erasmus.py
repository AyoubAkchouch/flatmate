"""Generates 100 synthetic Erasmus students (30 of whom sublet their flat back home).

Writes:
  supabase/synthetic-erasmus-100.sql   paste into the Supabase SQL Editor
  data/synthetic-erasmus-students.csv  the same students, for reading
  data/synthetic-erasmus-flats.csv     the 30 flats

Run: python3 tools/make_erasmus.py   (same output every time: fixed seed)
"""
import csv, json, math, random, uuid
from datetime import date, timedelta
from pathlib import Path

random.seed(2026)
ROOT = Path(__file__).resolve().parent.parent
NS = uuid.UUID("5f0c4a7e-6d1e-4b8a-9b55-2a9f0e8c1d00")

# City: country, language group, centre (lat, lng), market rent €/m² (furnished, approximate), universities with main site.
# City: country, language, centre (lat, lng), studio rent €/m², typical room in a flatshare (€/month), universities with main site.
# Rents are rough market levels for furnished student housing, for synthetic data only.
CITIES = {
    "Paris":     ("France", "fr", (48.8566, 2.3522), 35, 720, [("Sorbonne Université", 48.8466, 2.3560), ("Sciences Po", 48.8541, 2.3283), ("Université Paris Cité", 48.8290, 2.3810)]),
    "Lyon":      ("France", "fr", (45.7600, 4.8400), 20, 460, [("Université Lumière Lyon 2", 45.7490, 4.8380), ("Université Claude Bernard Lyon 1", 45.7800, 4.8660)]),
    "Madrid":    ("Spain", "es", (40.4168, -3.7038), 22, 480, [("Universidad Complutense de Madrid", 40.4480, -3.7280), ("Universidad Autónoma de Madrid", 40.5450, -3.6960)]),
    "Barcelona": ("Spain", "es", (41.3874, 2.1686), 24, 520, [("Universitat de Barcelona", 41.3870, 2.1640), ("Universitat Pompeu Fabra", 41.3910, 2.1910)]),
    "Berlin":    ("Germany", "de", (52.5200, 13.4050), 22, 560, [("Humboldt-Universität zu Berlin", 52.5180, 13.3930), ("Freie Universität Berlin", 52.4530, 13.2900)]),
    "Munich":    ("Germany", "de", (48.1372, 11.5756), 28, 720, [("Ludwig-Maximilians-Universität München", 48.1508, 11.5803), ("Technische Universität München", 48.1497, 11.5679)]),
    "Milan":     ("Italy", "it", (45.4642, 9.1900), 26, 620, [("Politecnico di Milano", 45.4780, 9.2270), ("Università Bocconi", 45.4500, 9.1890)]),
    "Bologna":   ("Italy", "it", (44.4949, 11.3426), 18, 450, [("Università di Bologna", 44.4970, 11.3530)]),
    "Lisbon":    ("Portugal", "pt", (38.7223, -9.1393), 22, 480, [("Universidade de Lisboa", 38.7520, -9.1580), ("Universidade NOVA de Lisboa", 38.7330, -9.1600)]),
    "Amsterdam": ("Netherlands", "nl", (52.3676, 4.9041), 32, 820, [("Universiteit van Amsterdam", 52.3560, 4.9550), ("Vrije Universiteit Amsterdam", 52.3340, 4.8660)]),
}
NAMES = {
    "fr": (["Léa", "Hugo", "Chloé", "Louis", "Inès", "Jules", "Manon", "Arthur", "Camille", "Yanis", "Zoé", "Mehdi"], ["Martin", "Bernard", "Dubois", "Lefebvre", "Moreau", "Laurent", "Fournier", "Girard", "Haddad", "Benali"]),
    "es": (["Lucía", "Mateo", "Sofía", "Pablo", "Carmen", "Diego", "Alba", "Javier", "Irene", "Hugo", "Marta", "Álvaro"], ["García", "Fernández", "López", "Martínez", "Sánchez", "Romero", "Navarro", "Ruiz", "Torres", "Gil"]),
    "de": (["Lena", "Jonas", "Hannah", "Felix", "Mia", "Lukas", "Emilia", "Paul", "Clara", "Elias", "Anna", "Noah"], ["Müller", "Schmidt", "Schneider", "Fischer", "Weber", "Wagner", "Becker", "Hoffmann", "Koch", "Yilmaz"]),
    "it": (["Giulia", "Lorenzo", "Chiara", "Matteo", "Sara", "Alessandro", "Martina", "Davide", "Alice", "Tommaso", "Elena", "Luca"], ["Rossi", "Russo", "Ferrari", "Esposito", "Bianchi", "Romano", "Colombo", "Ricci", "Marino", "Greco"]),
    "pt": (["Beatriz", "João", "Mariana", "Tiago", "Inês", "Rodrigo", "Catarina", "Miguel", "Leonor", "Duarte", "Rita", "Tomás"], ["Silva", "Santos", "Ferreira", "Pereira", "Oliveira", "Costa", "Rodrigues", "Martins", "Sousa", "Gomes"]),
    "nl": (["Sanne", "Daan", "Emma", "Lars", "Fleur", "Sem", "Lotte", "Bram", "Noor", "Thijs", "Eva", "Jesse"], ["de Jong", "Jansen", "de Vries", "van Dijk", "Bakker", "Visser", "Smit", "Meijer", "Mulder", "Bos"]),
}
STREETS = {
    "Paris": ["rue Oberkampf", "rue de Belleville", "boulevard Voltaire", "rue de la Roquette", "rue Mouffetard", "rue des Martyrs"],
    "Lyon": ["rue de la République", "cours Gambetta", "rue Paul Bert", "montée de la Grande Côte", "rue Duguesclin", "avenue Berthelot"],
    "Madrid": ["Calle de Toledo", "Calle de Alcalá", "Calle del Pez", "Calle de Fuencarral", "Calle de Embajadores", "Calle de Atocha"],
    "Barcelona": ["Carrer de Mallorca", "Carrer de Verdi", "Carrer de Sants", "Carrer de Còrsega", "Carrer de Blai", "Carrer del Parlament"],
    "Berlin": ["Schönhauser Allee", "Kastanienallee", "Wiener Straße", "Gneisenaustraße", "Sonnenallee", "Boxhagener Straße"],
    "Munich": ["Leopoldstraße", "Türkenstraße", "Schellingstraße", "Lindwurmstraße", "Gollierstraße", "Augustenstraße"],
    "Milan": ["Corso Buenos Aires", "Via Padova", "Viale Monza", "Via Vigevano", "Via Pacini", "Via Solari"],
    "Bologna": ["Via Zamboni", "Via San Vitale", "Via del Pratello", "Via Mascarella", "Strada Maggiore", "Via Saragozza"],
    "Lisbon": ["Rua da Graça", "Avenida de Roma", "Rua do Benformoso", "Rua de São Bento", "Rua dos Anjos", "Rua Morais Soares"],
    "Amsterdam": ["Kinkerstraat", "Ferdinand Bolstraat", "Javastraat", "Haarlemmerdijk", "Czaar Peterstraat", "Bilderdijkstraat"],
}
FEATURES = ["Furnished", "Bills included", "Washing machine", "Wi-Fi", "Balcony", "Near public transport", "Bike storage", "Quiet street"]
LIFESTYLE = ["Non-smoker", "Quiet", "Tidy", "Early riser", "Night owl", "Has a pet", "Often away at weekends"]
ADJ = ["Bright", "Cosy", "Quiet", "Sunny", "Renovated", "Charming", "Calm", "Spacious", "Modern", "Top-floor"]

def jitter(lat, lng, km):
    r = km * math.sqrt(random.random()); a = random.random() * 2 * math.pi
    return round(lat + r * math.sin(a) / 111.0, 6), round(lng + r * math.cos(a) / (111.0 * math.cos(math.radians(lat))), 6)

def semester():
    r = random.random(); d = lambda y, m, day: date(y, m, day)
    if r < 0.6:   return d(2027, 1, 25) + timedelta(random.randint(0, 25)), d(2027, 6, 20) + timedelta(random.randint(0, 30))   # spring semester
    if r < 0.85:  return d(2027, 8, 28) + timedelta(random.randint(0, 20)), d(2028, 1, 25) + timedelta(random.randint(0, 25))  # autumn semester
    return d(2027, 8, 28) + timedelta(random.randint(0, 20)), d(2028, 6, 10) + timedelta(random.randint(0, 25))                 # full year

def pick_some(items, p):
    return [x for x in items if random.random() < p]

city_names = list(CITIES)
students, flats = [], []
used_names = set()
for n in range(1, 101):
    home = random.choice(city_names)
    dest = random.choice([c for c in city_names if CITIES[c][0] != CITIES[home][0] or c != home])
    while dest == home: dest = random.choice(city_names)
    hc, dc = CITIES[home], CITIES[dest]
    lang = hc[1]
    while True:
        name = f"{random.choice(NAMES[lang][0])} {random.choice(NAMES[lang][1])}"
        if name not in used_names: used_names.add(name); break
    home_uni = random.choice(hc[5])[0]
    dest_uni, ulat, ulng = random.choice(dc[5])
    clat, clng = jitter(ulat, ulng, 0.4)
    d_from, d_to = semester()
    # Budget somewhere between a cheap room and a comfortable studio in the destination city.
    budget = int(round(random.uniform(dc[4] * 0.9, dc[3] * 28) / 50) * 50)
    sid = str(uuid.uuid5(NS, f"student-{n}"))
    s = dict(n=n, id=sid, email=f"erasmus-{n}@synthetic.flatmate.test", full_name=name,
             home_city=home, home_country=hc[0], home_university=home_uni,
             destination_city=dest, destination_country=dc[0], host_university=dest_uni, host_lat=clat, host_lng=clng,
             exchange_from=d_from.isoformat(), exchange_to=d_to.isoformat(), budget_max=max(400, budget),
             kind_pref=random.choice(["any", "any", "whole", "room"]), max_commute=random.choice([30, 45, 45, 60]),
             must_haves=pick_some(["Furnished"], 0.55), nice_to_haves=pick_some(["Wi-Fi", "Washing machine", "Balcony", "Bills included"], 0.35),
             lifestyle=pick_some(LIFESTYLE, 0.3), id_status="verified" if random.random() < 0.92 else "pending",
             student_status="verified" if random.random() < 0.9 else "pending", lists_own_flat=False)
    students.append(s)

# 30% list the flat they leave behind, in their home city, free during their exchange.
for s in random.sample(students, 30):
    s["lists_own_flat"] = True
    hc = CITIES[s["home_city"]]
    lang = hc[1]
    kind = "whole" if random.random() < 0.6 else "room"
    size = random.randint(9, 16) if kind == "room" else (random.randint(18, 26) if random.random() < 0.6 else random.randint(27, 48))
    rent = hc[4] * (size / 12) ** 0.4 if kind == "room" else hc[3] * size
    rent = int(round(rent * random.uniform(0.85, 1.15) / 10) * 10)
    lat, lng = jitter(*hc[2], 3.0)
    district = random.choice(["centre", "north", "east", "west", "south"])
    title = (f"{random.choice(ADJ)} room in a {random.randint(2, 4)}-person flatshare" if kind == "room"
             else f"{random.choice(ADJ)} {'studio' if size < 27 else 'one-bedroom'} in {s['home_city']}")
    flats.append(dict(id=str(uuid.uuid5(NS, f"flat-{s['n']}")), owner_id=s["id"], owner_name=s["full_name"], kind=kind, title=title,
                      city=s["home_city"], area=f"{s['home_city']} · {district}",
                      address=(f"{random.randint(1, 120)} {random.choice(STREETS[s['home_city']])}, {s['home_city']}" if lang == "fr"
                               else f"{random.choice(STREETS[s['home_city']])} {random.randint(1, 120)}, {s['home_city']}"),
                      lat=lat, lng=lng, available_from=s["exchange_from"], available_to=s["exchange_to"], size_m2=size,
                      rent=rent, lease_rent=rent + random.choice([0, 0, 10, 20, 30]), tags=pick_some(FEATURES, 0.4),
                      landlord_name=f"{random.choice(NAMES[lang][1])}"))

# ---------- SQL ----------
q = lambda v: "null" if v is None else "'" + str(v).replace("'", "''") + "'"
arr = lambda xs: q("{" + ",".join('"' + x.replace('"', '') + '"' for x in xs) + "}") + "::text[]"
out = []
out.append("""-- ============================================================
-- SYNTHETIC ERASMUS STUDENTS: 100 students moving between 10 European cities,
-- 30 of whom also sublet their flat back home (dual-use profiles).
-- Adds to what's already there; removes only an earlier copy of this same set.
-- Needs updates 4 and 5 to have been run first.
-- Generated by tools/make_erasmus.py (fixed seed: same data every time).
-- Run in Supabase → SQL Editor → New query → paste → Run.
-- ============================================================
delete from auth.users where email like 'erasmus-%@synthetic.flatmate.test';
select setseed(0.2026);
""")
out.append("insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values")
out.append(",\n".join(f"('00000000-0000-0000-0000-000000000000', {q(s['id'])}, 'authenticated', 'authenticated', {q(s['email'])}, '', now(), '{{\"provider\":\"email\",\"providers\":[\"email\"]}}', '{{}}', now(), now())" for s in students) + ";\n")
out.append("""update public.profiles p set role = 'seeker', onboarded = true, full_name = v.full_name, city = v.city, home_city = v.home_city,
  home_university = v.home_university, host_university = v.host_university, host_lat = v.host_lat, host_lng = v.host_lng,
  exchange_from = v.d_from::date, exchange_to = v.d_to::date, budget_max = v.budget_max, kind_pref = v.kind_pref,
  max_commute = v.max_commute, must_haves = v.must_haves, nice_to_haves = v.nice_to_haves, lifestyle = v.lifestyle,
  id_status = v.id_status, student_status = v.student_status, view_mode = v.view_mode,
  wanted_lifestyle = v.wanted_lifestyle
from (values""")
rows = []
for s in students:
    rows.append(f"({q(s['id'])}::uuid, {q(s['full_name'])}, {q(s['destination_city'])}, {q(s['home_city'])}, {q(s['home_university'])}, {q(s['host_university'])}, "
                f"{s['host_lat']}, {s['host_lng']}, {q(s['exchange_from'])}, {q(s['exchange_to'])}, {s['budget_max']}, {q(s['kind_pref'])}, {s['max_commute']}, "
                f"{arr(s['must_haves'])}, {arr(s['nice_to_haves'])}, {arr(s['lifestyle'])}, {q(s['id_status'])}, {q(s['student_status'])}, "
                f"{q('provider' if s['lists_own_flat'] and random.random() < 0.5 else 'seeker')}, {arr(pick_some(['Non-smoker', 'Quiet', 'Tidy'], 0.4) if s['lists_own_flat'] else [])})")
out.append(",\n".join(rows))
out.append(""") as v(id, full_name, city, home_city, home_university, host_university, host_lat, host_lng, d_from, d_to, budget_max, kind_pref,
  max_commute, must_haves, nice_to_haves, lifestyle, id_status, student_status, view_mode, wanted_lifestyle)
where p.id = v.id;
""")
out.append("insert into public.listings (id, owner_id, kind, title, city, area, address, lat, lng, available_from, available_to, size_m2, rent, lease_rent, tags, landlord_name, active, created_at) values")
out.append(",\n".join(f"({q(f['id'])}, {q(f['owner_id'])}, {q(f['kind'])}, {q(f['title'])}, {q(f['city'])}, {q(f['area'])}, {q(f['address'])}, {f['lat']}, {f['lng']}, "
                      f"{q(f['available_from'])}, {q(f['available_to'])}, {f['size_m2']}, {f['rent']}, {f['lease_rent']}, {arr(f['tags'])}, {q(f['landlord_name'])}, true, now() - random() * interval '10 days')"
                      for f in flats) + ";\n")
out.append("""-- ---------- A week of activity: each student looks at flats near their destination school and says yes to good fits ----------
create temp table era_seen as
select s.id as seeker_id, c.id as listing_id, c.rent, s.budget_max,
  row_number() over (partition by s.id order by c.km * 20 + greatest(0, c.rent - s.budget_max) + random() * 100) as rk
from public.profiles s
cross join lateral (
  select l.id, l.rent,
    sqrt(power((l.lat - s.host_lat) * 111, 2) + power((l.lng - s.host_lng) * 111 * cos(radians(s.host_lat)), 2)) as km
  from public.listings l
  where l.active and not l.demo_auto_match and l.owner_id <> s.id and l.lat is not null
    and abs(l.lat - s.host_lat) < 0.5 and abs(l.lng - s.host_lng) < 0.7
    and l.available_from <= s.exchange_to and l.available_to >= s.exchange_from
  order by random() limit 20) c
where s.email like 'erasmus-%@synthetic.flatmate.test';

insert into public.listing_views (listing_id, user_id, created_at)
select listing_id, seeker_id, now() - random() * interval '7 days' from era_seen;
insert into public.swipes (listing_id, seeker_id, by_role, liked, created_at)
select listing_id, seeker_id, 'seeker', rk <= 4 and rent <= budget_max * 1.1, now() - random() * interval '7 days'
from era_seen where rk <= 8
on conflict do nothing;
insert into public.stars (user_id, listing_id, created_at)
select seeker_id, listing_id, now() - random() * interval '7 days' from era_seen where rk <= 2 and random() < 0.5
on conflict do nothing;

-- A third of the 30 Erasmus flats say yes back automatically, so a real student can match on stage.
update public.listings set demo_auto_match = (random() < 0.33)
where owner_id in (select id from public.profiles where email like 'erasmus-%@synthetic.flatmate.test');

select (select count(*) from public.profiles where email like 'erasmus-%') as erasmus_students,
  (select count(*) from public.listings l join public.profiles p on p.id = l.owner_id where p.email like 'erasmus-%') as their_flats,
  (select count(*) from era_seen) as views,
  (select count(*) from public.swipes s join public.listings l on l.id = s.listing_id join public.profiles p on p.id = l.owner_id
     where p.email like 'erasmus-%' and s.by_role = 'seeker' and s.liked) as yeses_on_their_flats;
""")
(ROOT / "supabase/synthetic-erasmus-100.sql").write_text("\n".join(out), encoding="utf-8")

# ---------- CSV ----------
(ROOT / "data").mkdir(exist_ok=True)
with open(ROOT / "data/synthetic-erasmus-students.csv", "w", newline="", encoding="utf-8") as fh:
    cols = ["n", "full_name", "email", "home_city", "home_country", "home_university", "destination_city", "destination_country",
            "host_university", "exchange_from", "exchange_to", "budget_max", "kind_pref", "max_commute", "must_haves", "nice_to_haves",
            "lifestyle", "id_status", "student_status", "lists_own_flat"]
    w = csv.DictWriter(fh, fieldnames=cols, extrasaction="ignore"); w.writeheader()
    for s in students:
        w.writerow({**s, "must_haves": ", ".join(s["must_haves"]), "nice_to_haves": ", ".join(s["nice_to_haves"]), "lifestyle": ", ".join(s["lifestyle"]),
                    "lists_own_flat": "yes" if s["lists_own_flat"] else "no"})
with open(ROOT / "data/synthetic-erasmus-flats.csv", "w", newline="", encoding="utf-8") as fh:
    cols = ["owner_name", "title", "kind", "city", "address", "size_m2", "rent", "lease_rent", "available_from", "available_to", "tags"]
    w = csv.DictWriter(fh, fieldnames=cols, extrasaction="ignore"); w.writeheader()
    for f in flats: w.writerow({**f, "tags": ", ".join(f["tags"])})

from collections import Counter
print("students:", len(students), "flats:", len(flats))
print("destinations:", dict(Counter(s["destination_city"] for s in students)))
print("flats by city:", dict(Counter(f["city"] for f in flats)))
