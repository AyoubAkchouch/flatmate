"""Generates supabase/synthetic-nyc-100.sql: 100 exchange students looking for a flat in New York City
(with AI-generated profile photos) and 10 more New York flats (with Unsplash photos).
Also writes a readable copy to data/. Run: python3 tools/make_nyc.py
"""
import csv, json, math, random, uuid, datetime, os

random.seed(2026)
NS = uuid.UUID("6f1d2b4e-2f61-4c55-9a64-0a6b0c7e9b10")
uid = lambda key: str(uuid.uuid5(NS, key))
q = lambda s: "null" if s is None else "'" + str(s).replace("'", "''") + "'"
arr = lambda xs: "array[" + ",".join(q(x) for x in xs) + "]::text[]" if xs else "'{}'::text[]"

# ---------- Profile photos ----------
# 100 AI-generated faces (Figma image generation, owned by the team), cut from four 5x5 grids
# and stored in the Supabase "listing-photos" bucket. Order matters: names below follow these faces.
FACE = "https://qhrxjrhavlsfuuxznwbj.supabase.co/storage/v1/object/public/listing-photos/00000000-0000-4000-b000-0000000000aa/synthetic-faces/face-{:03d}.jpg"
# Each face: gender and the region its name is drawn from (EA East Asia, SA South Asia, AF Africa,
# ME Middle East and North Africa, LA Latin America and Iberia, EU Europe).
FACES = """F EA,M AF,F LA,M ME,F EU,M SA,M EU,F AF,M EA,F LA,
M AF,F SA,F EU,F EA,M ME,F LA,M EU,F ME,M AF,M EA,
F EU,M LA,F EA,M SA,F AF,F LA,M AF,M EA,F SA,M EU,
F ME,M EA,F AF,M LA,F AF,F LA,M AF,F EA,M ME,F EU,
F AF,M EA,F EA,M EU,F SA,F LA,M EU,F SA,M AF,F LA,
F EA,M AF,F EU,M LA,F ME,M SA,F SA,M AF,F EU,M EU,
F ME,M EA,F EU,M EA,F AF,M EA,F LA,M ME,M EA,F AF,
F EA,F EU,F LA,M EU,M SA,F EU,M AF,F ME,M LA,F LA,
F LA,M SA,F EA,M EU,F AF,F ME,M EU,F LA,M SA,F EU,
F AF,M EA,F ME,M ME,F SA,F LA,M AF,F EU,M ME,F LA""".replace("\n", "").split(",")
FACES = [tuple(x.strip().split()) for x in FACES]
assert len(FACES) == 100

NAMES = {
  ("F", "EA"): ["Mei Lin Zhang", "Ji-woo Park", "Yuki Tanaka", "Hana Kim", "Linh Nguyen", "Xinyi Chen", "Seo-yeon Lee", "Aiko Watanabe", "Wen Liu", "Mai Tran", "Sakura Ito", "Yerin Choi", "Qing Wu"],
  ("M", "EA"): ["Wei Zhang", "Min-jun Kim", "Haruto Sato", "Jun-ho Park", "Duc Pham", "Hao Wang", "Kenji Mori", "Tae-yang Choi", "Ren Takahashi", "Bao Le", "Yifan Zhou", "Daichi Suzuki", "Sung-min Han"],
  ("F", "SA"): ["Priya Sharma", "Ananya Iyer", "Sana Malik", "Aditi Rao", "Nisha Patel", "Meera Krishnan", "Ayesha Siddiqui", "Tanvi Desai"],
  ("M", "SA"): ["Arjun Mehta", "Rohan Gupta", "Vikram Nair", "Imran Qureshi", "Karan Singh", "Rahul Bose", "Farhan Chowdhury"],
  ("F", "AF"): ["Amara Okeke", "Zainab Bello", "Wanjiru Kamau", "Adwoa Mensah", "Fatou Diallo", "Thandiwe Ndlovu", "Ngozi Eze", "Aminata Sow", "Esi Owusu", "Nia Achieng"],
  ("M", "AF"): ["Kwame Asante", "Chidi Nwosu", "Tunde Adeyemi", "Kofi Boateng", "Moussa Traoré", "Sipho Dlamini", "Emeka Obi", "Brian Otieno", "Yaw Darko", "Ibrahima Ndiaye", "Tendai Moyo"],
  ("F", "ME"): ["Layla Haddad", "Noor Al-Sayed", "Yasmin Benali", "Fatima Zahra El Idrissi", "Mariam Khoury", "Aylin Demir", "Leila Rahimi", "Rania Farouk", "Salma Haddadi"],
  ("M", "ME"): ["Omar Haddad", "Karim Mansour", "Youssef Benjelloun", "Emre Yılmaz", "Amir Hosseini", "Tariq Nasser", "Hamza Alaoui", "Can Öztürk"],
  ("F", "LA"): ["Valentina Rojas", "Camila Fernández", "Isabela Souza", "Mariana López", "Lucía Martínez", "Sofía Herrera", "Daniela Vargas", "Gabriela Mendes", "Paula Castro", "Renata Silva", "Carolina Ruiz", "Ximena Torres", "Ana Beatriz Lima", "Elena Navarro", "Julieta Pérez", "Natalia Gómez"],
  ("M", "LA"): ["Mateo González", "Diego Ramírez", "Santiago Morales", "Gabriel Costa", "Andrés Castillo", "Tomás Herrera"],
  ("F", "EU"): ["Emma Schmidt", "Clara Dubois", "Freja Nielsen", "Giulia Romano", "Sophie van Dijk", "Hannah Müller", "Maja Kowalska", "Chloé Martin", "Ingrid Larsen", "Anna Novák", "Saoirse Kelly", "Elise Janssens", "Lea Fischer", "Matilda Berg"],
  ("M", "EU"): ["Lukas Becker", "Matteo Rossi", "Oscar Lindqvist", "Pierre Laurent", "Jakub Nowak", "Finn O'Brien", "Jonas Weber", "Liam Murphy", "Lars Jensen", "Tom de Vries", "Nicolas Lefèvre", "Felix Wagner"],
}
UNIS = {
  "EA": [("Tsinghua University", "Beijing"), ("Seoul National University", "Seoul"), ("University of Tokyo", "Tokyo"), ("Yonsei University", "Seoul"), ("Fudan University", "Shanghai"), ("Kyoto University", "Kyoto"), ("National Taiwan University", "Taipei"), ("Vietnam National University, Hanoi", "Hanoi"), ("Peking University", "Beijing"), ("Korea University", "Seoul")],
  "SA": [("Indian Institute of Technology Bombay", "Mumbai"), ("University of Delhi", "Delhi"), ("Lahore University of Management Sciences", "Lahore"), ("Ashoka University", "Sonipat"), ("BITS Pilani", "Pilani"), ("University of Dhaka", "Dhaka")],
  "AF": [("University of Lagos", "Lagos"), ("University of Ghana", "Accra"), ("University of Nairobi", "Nairobi"), ("University of Cape Town", "Cape Town"), ("Université Cheikh Anta Diop", "Dakar"), ("Makerere University", "Kampala"), ("University of the Witwatersrand", "Johannesburg")],
  "ME": [("American University of Beirut", "Beirut"), ("Cairo University", "Cairo"), ("Boğaziçi University", "Istanbul"), ("Université Mohammed V de Rabat", "Rabat"), ("University of Tehran", "Tehran"), ("University of Jordan", "Amman")],
  "LA": [("Universidad de los Andes", "Bogotá"), ("Universidade de São Paulo", "São Paulo"), ("Universidad Nacional Autónoma de México", "Mexico City"), ("Pontificia Universidad Católica de Chile", "Santiago"), ("Universidad de Buenos Aires", "Buenos Aires"), ("Universidad Complutense de Madrid", "Madrid"), ("Tecnológico de Monterrey", "Monterrey")],
  "EU": [("Sciences Po", "Paris"), ("Ludwig-Maximilians-Universität München", "Munich"), ("University of Copenhagen", "Copenhagen"), ("Università di Bologna", "Bologna"), ("University of Amsterdam", "Amsterdam"), ("KU Leuven", "Leuven"), ("Trinity College Dublin", "Dublin"), ("Uppsala University", "Uppsala"), ("ETH Zürich", "Zürich"), ("University of Warsaw", "Warsaw"), ("Sorbonne Université", "Paris"), ("Charles University", "Prague")],
}
# New York schools and the campus each student studies at (name, campus label, lat, lng).
SCHOOLS = [
  ("Columbia University", "Morningside Heights campus", 40.8075, -73.9626, 14),
  ("Columbia University", "Manhattanville campus", 40.8174, -73.9580, 3),
  ("New York University", "Washington Square campus", 40.7295, -73.9965, 16),
  ("New York University", "Tandon School of Engineering, Brooklyn", 40.6942, -73.9866, 5),
  ("The New School", "Greenwich Village campus", 40.7355, -73.9971, 8),
  ("Fordham University", "Lincoln Center campus", 40.7712, -73.9850, 6),
  ("Fordham University", "Rose Hill campus, the Bronx", 40.8610, -73.8885, 3),
  ("Hunter College, CUNY", "Main campus, Upper East Side", 40.7685, -73.9646, 7),
  ("Baruch College, CUNY", "Main campus, Gramercy", 40.7404, -73.9836, 6),
  ("City College of New York, CUNY", "Hamilton Heights campus", 40.8200, -73.9493, 6),
  ("Pratt Institute", "Brooklyn campus", 40.6913, -73.9632, 6),
  ("The Cooper Union", "Astor Place campus", 40.7290, -73.9905, 3),
  ("Fashion Institute of Technology", "Chelsea campus", 40.7472, -73.9945, 4),
  ("CUNY Graduate Center", "Fifth Avenue campus", 40.7486, -73.9840, 3),
]
FEATURES = ["Furnished", "Bills included", "Washing machine", "Wi-Fi", "Balcony", "Near public transport", "Bike storage", "Quiet street"]
LIFESTYLE = ["Non-smoker", "Quiet", "Tidy", "Early riser", "Night owl", "Has a pet", "Often away at weekends"]

# ---------- The 10 new flats ----------
U = "https://images.unsplash.com/{}?w=1200&q=80&auto=format&fit=crop"
FLATS = [
  # key, title, kind, area, address, lat, lng, m2, rent, lease, tags, photos, owner (name, uni, going to), landlord
  ("harlem", "Bright room in a Harlem brownstone", "room", "Harlem", "254 W 139th St, Apt 3, New York, NY 10030", 40.8196, -73.9452, 13, 1450, 1500,
   ["Furnished", "Wi-Fi", "Washing machine"], ["photo-1615874959474-d609969a20ed", "photo-1781249144129-4ba0869707f5", "photo-1604509082195-1d60a05fbe1e"],
   ("Jordan Ellis", "City College of New York, CUNY", "University of Edinburgh"), ("Lorraine Haskins", "l.haskins@example.com")),
  ("williamsburg", "Williamsburg loft near Bedford Ave", "whole", "Williamsburg, Brooklyn", "164 N 6th St, Apt 4R, Brooklyn, NY 11211", 40.7183, -73.9590, 58, 3900, 4100,
   ["Furnished", "Wi-Fi", "Near public transport", "Washing machine"], ["photo-1783990349147-906f62b882c1", "photo-1633505765486-e404bbbec654", "photo-1764542632053-974f89c30e0f"],
   ("Elena Petrova", "New York University", "Sciences Po, Paris"), ("North Sixth Realty", "leasing@northsixth.example.com")),
  ("lic", "Long Island City studio with a skyline view", "whole", "Long Island City, Queens", "27-28 Thomson Ave, Apt 12C, Long Island City, NY 11101", 40.7449, -73.9372, 40, 3100, 3100,
   ["Furnished", "Bills included", "Wi-Fi", "Near public transport"], ["photo-1583847268964-b28dc8f51f92", "photo-1744974256549-8ece7cdb5dd2", "photo-1667035100798-e33c8d148556"],
   ("Daniel Cho", "Baruch College, CUNY", "Yonsei University, Seoul"), ("Queensview Management", "office@queensview.example.com")),
  ("ues", "Upper East Side one-bedroom near Hunter", "whole", "Upper East Side", "321 E 71st St, Apt 5D, New York, NY 10021", 40.7676, -73.9567, 48, 3350, 3350,
   ["Furnished", "Wi-Fi", "Quiet street", "Near public transport"], ["photo-1629042306558-7d1e15cc02fa", "photo-1780884864627-3e1664eb8feb", "photo-1608841805871-7d160f0e0c04"],
   ("Rebecca Stein", "Hunter College, CUNY", "University of Copenhagen"), ("Margaret O'Neill", "m.oneill@example.com")),
  ("wh", "Room near Columbia's medical campus", "room", "Washington Heights", "560 W 168th St, Apt 6, New York, NY 10032", 40.8406, -73.9420, 12, 1250, 1300,
   ["Furnished", "Wi-Fi", "Near public transport"], ["photo-1612419299101-6c294dc2901d", "photo-1765464184843-105e144bd54b", "photo-1738516889293-9a67469ea909"],
   ("Luis Almonte", "Columbia University", "Universidad Complutense de Madrid"), ("Rafael Batista", "r.batista@example.com")),
  ("bushwick", "Room in a Bushwick loft share", "room", "Bushwick, Brooklyn", "1092 Flushing Ave, Apt 3F, Brooklyn, NY 11237", 40.7044, -73.9273, 15, 1350, 1350,
   ["Furnished", "Wi-Fi", "Bike storage"], ["photo-1617817643768-8855fc457e3a", "photo-1541004995602-b3e898709909", "photo-1577640204417-a73c72c7cb97"],
   ("Marcus Bell", "Pratt Institute", "Central Saint Martins, London"), ("Flushing Lofts LLC", "rentals@flushinglofts.example.com")),
  ("greenpoint", "Greenpoint one-bedroom by McCarren Park", "whole", "Greenpoint, Brooklyn", "118 Nassau Ave, Apt 2L, Brooklyn, NY 11222", 40.7233, -73.9500, 45, 3050, 3150,
   ["Furnished", "Washing machine", "Wi-Fi", "Quiet street"], ["photo-1502672260266-1c1ef2d93688", "photo-1734599511415-cb4a52aea2fe", "photo-1684508405245-3d3dac130dfc"],
   ("Kasia Wiśniewska", "The New School", "Universiteit van Amsterdam"), ("Tadeusz Kowalczyk", "t.kowalczyk@example.com")),
  ("bedstuy", "Room in a Bed-Stuy brownstone", "room", "Bedford-Stuyvesant, Brooklyn", "389 Macon St, Brooklyn, NY 11233", 40.6826, -73.9333, 16, 1400, 1450,
   ["Furnished", "Washing machine", "Wi-Fi", "Quiet street"], ["photo-1613575831056-0acd5da8f085", "photo-1619810230359-b2c2f61c49cd", "photo-1666601248988-cd17421bbb29"],
   ("Aaliyah Brooks", "Pratt Institute", "Università di Bologna"), ("Gloria Simmons", "g.simmons@example.com")),
  ("hk", "Hell's Kitchen studio near Midtown", "whole", "Hell's Kitchen", "452 W 49th St, Apt 4A, New York, NY 10019", 40.7627, -73.9906, 32, 3200, 3200,
   ["Furnished", "Bills included", "Wi-Fi", "Near public transport"], ["photo-1600493505873-cddd69453072", "photo-1759691337936-ef702afd0714", "photo-1689072597757-1d5a6daba434"],
   ("Noah Friedman", "Fordham University", "Trinity College Dublin"), ("Clinton Housing Co.", "info@clintonhousing.example.com")),
  ("crown", "Private room in a Crown Heights two-bed", "room", "Crown Heights, Brooklyn", "1184 Bergen St, Apt 2, Brooklyn, NY 11213", 40.6762, -73.9440, 14, 1300, 1350,
   ["Furnished", "Wi-Fi", "Near public transport"], ["photo-1702014862053-946a122b920d", "photo-1758098491492-6501dfb2ae7d", "photo-1552418844-c3bf1431ea48"],
   ("Devon Clarke", "Brooklyn College, CUNY", "University of Cape Town"), ("Bergen Street Properties", "hello@bergenst.example.com")),
]

def km(a, b):
    r = math.radians
    h = math.sin(r(b[0] - a[0]) / 2) ** 2 + math.cos(r(a[0])) * math.cos(r(b[0])) * math.sin(r(b[1] - a[1]) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))
minutes = lambda a, b: round(7 + 3.4 * km(a, b))
D = datetime.date

# ---------- Seekers ----------
used = {k: 0 for k in NAMES}
school_pool = [s for s in SCHOOLS for _ in range(s[4])]
seekers = []
for i, (g, region) in enumerate(FACES, start=1):
    pool = NAMES[(g, region)]
    name = pool[used[(g, region)] % len(pool)]
    if used[(g, region)] >= len(pool):
        name += " " + random.choice("ABCDEFGHJKLMNPRSTW") + "."
    used[(g, region)] += 1
    uni, home_city = random.choice(UNIS[region])
    school, campus, lat, lng, _ = random.choice(school_pool)
    term = random.choices(["spring", "spring-long", "fall", "year"], [55, 15, 18, 12])[0]
    if term == "spring": start, end = D(2027, 1, random.randint(4, 20)), D(2027, 5, random.randint(10, 28))
    elif term == "spring-long": start, end = D(2027, 1, random.randint(4, 15)), D(2027, 6, random.randint(10, 30))
    elif term == "fall": start, end = D(2027, 8, random.randint(18, 31)), D(2027, 12, random.randint(15, 22))
    else: start, end = D(2027, 1, random.randint(4, 15)), D(2027, 12, random.randint(10, 20))
    kind = random.choices(["any", "room", "whole"], [45, 35, 20])[0]
    budget = int(round(random.lognormvariate(math.log(1900 if kind != "whole" else 3000), 0.22) / 50) * 50)
    budget = max(1100, min(budget, 4500))
    seekers.append(dict(
        id=uid(f"nyc-seeker-{i}"), email=f"nyc-seeker-{i}@synthetic.flatmate.test", name=name, gender=g,
        uni=uni, home_city=home_city, school=school, campus=f"{school}, {campus}", lat=lat, lng=lng,
        start=start, end=end, kind=kind, budget=budget, commute=random.choice([30, 45, 45, 45, 60]),
        must=random.sample(["Furnished", "Wi-Fi"], random.choice([0, 1, 1, 2])),
        nice=random.sample(["Washing machine", "Near public transport", "Quiet street", "Bills included", "Bike storage"], random.randint(0, 3)),
        life=random.sample(LIFESTYLE[:5] + ["Often away at weekends"], random.randint(1, 3)),
        id_status="verified", student_status=random.choices(["verified", "pending"], [92, 8])[0],
        face=FACE.format(i)))

# ---------- Flats and their owners ----------
flats = []
for n, (key, title, kind, area, address, lat, lng, m2, rent, lease, tags, photos, owner, landlord) in enumerate(FLATS, start=6):
    s, e = random.choice([(D(2027, 1, 5), D(2027, 6, 10)), (D(2027, 1, 8), D(2027, 5, 31)), (D(2027, 1, 3), D(2027, 12, 20)), (D(2027, 8, 20), D(2027, 12, 22))])
    flats.append(dict(key=key, id=uid(f"nyc-flat-{key}"), owner_id=uid(f"nyc-owner-{n}"), owner_email=f"nyc-owner-{n}@synthetic.flatmate.test",
        owner=owner, title=title, kind=kind, area=area, address=address, lat=lat, lng=lng, m2=m2, rent=rent, lease=lease, tags=tags,
        photos=[U.format(p) for p in photos], landlord=landlord, start=s, end=e))

# ---------- Swipes: each seeker says yes to the flats that fit them, and passes on a few ----------
now = datetime.datetime(2026, 10, 11, 12, 0)
swipes, views, stars = [], [], []
likes_so_far = {}
for s in seekers:
    scored = []
    for f in flats:
        overlap = (min(s["end"], f["end"]) - max(s["start"], f["start"])).days / max(1, (s["end"] - s["start"]).days)
        mins = minutes((s["lat"], s["lng"]), (f["lat"], f["lng"]))
        if overlap <= 0.3: continue
        fit = overlap * 2 - max(0, mins - s["commute"]) / 20 - max(0, f["rent"] - s["budget"]) / (0.15 * s["budget"])
        fit += 0.5 if s["kind"] in ("any", f["kind"]) else -1
        scored.append((fit + random.uniform(-1.2, 1.2), f))
    scored.sort(key=lambda x: -x[0])
    # Students rarely say yes to everything that fits: spread their interest across the flats.
    likes = [f for fit, f in scored[:random.randint(1, 3)] if fit > 0 and likes_so_far.get(f["id"], 0) < 30]
    for f in likes: likes_so_far[f["id"]] = likes_so_far.get(f["id"], 0) + 1
    passes = [f for fit, f in scored[len(likes):len(likes) + random.randint(0, 2)]]
    for f in likes + passes:
        t = now - datetime.timedelta(hours=random.randint(2, 160))
        swipes.append((f["id"], s["id"], f in likes, t))
        views.append((f["id"], s["id"], t - datetime.timedelta(minutes=random.randint(1, 30))))
        if f in likes and random.random() < 0.3: stars.append((s["id"], f["id"], t))

# ---------- SQL ----------
out = []
w = out.append
w("""-- ============================================================
-- 100 synthetic exchange students looking for a flat in New York City, with profile photos,
-- and 10 more synthetic New York flats with photos. Generated by tools/make_nyc.py.
-- The students have already said yes to the flats that fit them, so the people subletting
-- see ranked applicants. One subletter gets a login to try that side:
--     email:    demo.nyc.provider@synthetic.flatmate.test
--     password: FlatmateDemo-2026
-- Needs updates 6 and 7. Run in Supabase → SQL Editor → New query → paste → Run. Safe to run again.
-- synthetic-cleanup.sql removes all of it.
--
-- Profile photos: AI-generated faces (these people don't exist), made with Figma's image generator,
-- stored in this project's Supabase storage. Flat photos: free Unsplash photos (unsplash.com/license);
-- interiors are illustrative, not the actual flats. Rents: typical 2026 New York asking rents.
-- ============================================================
""")
people = [(s["id"], s["email"]) for s in seekers] + [(f["owner_id"], f["owner_email"]) for f in flats]
w("insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values")
w(",\n".join(f"('00000000-0000-0000-0000-000000000000', {q(i)}, 'authenticated', 'authenticated', {q(e)}, '', now(), '{{\"provider\":\"email\",\"providers\":[\"email\"]}}', '{{}}', now(), now())" for i, e in people))
w("on conflict (id) do nothing;\n")

w("-- The students looking for a flat")
w("update public.profiles p set role = 'seeker', full_name = d.name, home_university = d.uni, home_city = d.home_city,")
w("  host_university = d.school, host_campus = d.campus, host_lat = d.lat, host_lng = d.lng, city = 'New York',")
w("  exchange_from = d.f, exchange_to = d.t, id_status = 'verified', student_status = d.st, onboarded = true, view_mode = 'seeker',")
w("  budget_max = d.budget, kind_pref = d.kind, max_commute = d.commute, must_haves = d.must, nice_to_haves = d.nice, lifestyle = d.life, avatar_url = d.face")
w("from (values")
w(",\n".join(f"  ({q(s['id'])}::uuid, {q(s['name'])}, {q(s['uni'])}, {q(s['home_city'])}, {q(s['school'])}, {q(s['campus'])}, {s['lat']}, {s['lng']}, {q(s['start'])}::date, {q(s['end'])}::date, {q(s['student_status'])}, {s['budget']}, {q(s['kind'])}, {s['commute']}, {arr(s['must'])}, {arr(s['nice'])}, {arr(s['life'])}, {q(s['face'])})" for s in seekers))
w(") as d(id, name, uni, home_city, school, campus, lat, lng, f, t, st, budget, kind, commute, must, nice, life, face)\nwhere p.id = d.id;\n")

w("-- The students subletting the 10 new flats")
w("update public.profiles p set role = 'subletter', full_name = d.name, home_university = d.uni, host_university = d.dest,")
w("  city = 'New York', home_city = 'New York', exchange_from = d.f, exchange_to = d.t,")
w("  id_status = 'verified', student_status = 'verified', onboarded = true, min_overlap_pct = 50, require_verified = true,")
w("  wanted_lifestyle = d.wanted")
w("from (values")
w(",\n".join(f"  ({q(f['owner_id'])}::uuid, {q(f['owner'][0])}, {q(f['owner'][1])}, {q(f['owner'][2])}, {q(f['start'])}::date, {q(f['end'])}::date, {arr(random.sample(['Non-smoker', 'Quiet', 'Tidy'], 2))})" for f in flats))
w(") as d(id, name, uni, dest, f, t, wanted)\nwhere p.id = d.id;\n")

w("-- The 10 new flats (they don't say yes automatically: their students review applicants)")
w("insert into public.listings (id, owner_id, kind, title, city, area, address, lat, lng, available_from, available_to, size_m2, rent, lease_rent, currency, tags, photos, landlord_name, landlord_email, demo_auto_match, baseline_interest) values")
w(",\n".join(f"  ({q(f['id'])}, {q(f['owner_id'])}, {q(f['kind'])}, {q(f['title'])}, 'New York', {q(f['area'])}, {q(f['address'])}, {f['lat']}, {f['lng']}, {q(f['start'])}, {q(f['end'])}, {f['m2']}, {f['rent']}, {f['lease']}, 'USD', {arr(f['tags'])}, {arr(f['photos'])}, {q(f['landlord'][0])}, {q(f['landlord'][1])}, false, 0)" for f in flats))
w("""on conflict (id) do update set title = excluded.title, area = excluded.area, address = excluded.address, lat = excluded.lat, lng = excluded.lng,
  available_from = excluded.available_from, available_to = excluded.available_to, size_m2 = excluded.size_m2, rent = excluded.rent,
  lease_rent = excluded.lease_rent, currency = excluded.currency, tags = excluded.tags, photos = excluded.photos,
  landlord_name = excluded.landlord_name, landlord_email = excluded.landlord_email, active = true;
""")
w("-- Who said yes or no to which flat, what they looked at and starred (last 7 days, so the demand gauge reacts)")
w("insert into public.swipes (listing_id, seeker_id, by_role, liked, created_at) values")
w(",\n".join(f"  ({q(l)}, {q(s)}, 'seeker', {str(lk).lower()}, {q(t.isoformat())}::timestamptz)" for l, s, lk, t in swipes))
w("on conflict (listing_id, seeker_id, by_role) do nothing;\n")
w("insert into public.listing_views (listing_id, user_id, created_at) select v.l::uuid, v.u::uuid, v.t::timestamptz from (values")
w(",\n".join(f"  ({q(l)}, {q(u)}, {q(t.isoformat())})" for l, u, t in views))
w(") as v(l, u, t)\nwhere not exists (select 1 from public.listing_views x where x.listing_id = v.l::uuid and x.user_id = v.u::uuid);\n")
w("insert into public.stars (user_id, listing_id, created_at) values")
w(",\n".join(f"  ({q(u)}, {q(l)}, {q(t.isoformat())}::timestamptz)" for u, l, t in stars))
w("on conflict do nothing;\n")

# The subletter with the most applicants gets a login.
likes_by = {}
for l, s, lk, t in swipes:
    if lk: likes_by[l] = likes_by.get(l, 0) + 1
best = max(flats, key=lambda f: likes_by.get(f["id"], 0))
w(f"""-- ---------- Login for the subletter with the most applicants ({best['owner'][0]}, {best['title']}) ----------
do $$
declare
  uid constant uuid := {q(best['owner_id'])};
  demo_email constant text := 'demo.nyc.provider@synthetic.flatmate.test';
  col text;
begin
  update auth.users set email = demo_email, encrypted_password = extensions.crypt('FlatmateDemo-2026', extensions.gen_salt('bf')),
    email_confirmed_at = coalesce(email_confirmed_at, now()) where id = uid;
  update public.profiles set email = demo_email where id = uid;
  -- Supabase's login expects these text fields to be empty rather than missing.
  for col in select column_name from information_schema.columns
    where table_schema = 'auth' and table_name = 'users'
      and column_name in ('confirmation_token', 'recovery_token', 'email_change_token_new', 'email_change',
                          'email_change_token_current', 'phone_change', 'phone_change_token', 'reauthentication_token')
  loop
    execute format('update auth.users set %I = coalesce(%I, '''') where id = $1', col, col) using uid;
  end loop;
  if not exists (select 1 from auth.identities where user_id = uid and provider = 'email') then
    begin
      insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
      values (gen_random_uuid(), uid, uid::text, 'email', jsonb_build_object('sub', uid::text, 'email', demo_email, 'email_verified', true), now(), now(), now());
    exception when undefined_column then
      insert into auth.identities (id, user_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
      values (uid::text, uid, 'email', jsonb_build_object('sub', uid::text, 'email', demo_email), now(), now(), now());
    end;
  end if;
end $$;

analyze public.swipes; analyze public.listing_views; analyze public.profiles; analyze public.listings;

-- What was added
select l.title, '$' || l.rent as rent, p.full_name as subletter,
  (select count(*) from public.swipes s where s.listing_id = l.id and s.by_role = 'seeker' and s.liked) as students_interested
from public.listings l join public.profiles p on p.id = l.owner_id
where l.id in ({",".join(q(f['id']) for f in flats)})
order by students_interested desc;
""")
os.makedirs("supabase", exist_ok=True)
open("supabase/synthetic-nyc-100.sql", "w").write("\n".join(out))

os.makedirs("data", exist_ok=True)
with open("data/nyc-seekers.csv", "w", newline="") as fh:
    cw = csv.writer(fh)
    cw.writerow(["email", "name", "home_university", "home_city", "school", "campus", "from", "to", "budget_usd", "kind", "max_commute", "must_haves", "lifestyle", "photo"])
    for s in seekers:
        cw.writerow([s["email"], s["name"], s["uni"], s["home_city"], s["school"], s["campus"], s["start"], s["end"], s["budget"], s["kind"], s["commute"], "; ".join(s["must"]), "; ".join(s["life"]), s["face"]])
with open("data/nyc-flats.csv", "w", newline="") as fh:
    cw = csv.writer(fh)
    cw.writerow(["title", "kind", "area", "address", "size_m2", "rent_usd", "from", "to", "subletter", "students_interested"])
    for f in flats:
        cw.writerow([f["title"], f["kind"], f["area"], f["address"], f["m2"], f["rent"], f["start"], f["end"], f["owner"][0], likes_by.get(f["id"], 0)])
print("seekers", len(seekers), "flats", len(flats), "swipes", len(swipes), "likes", sum(1 for x in swipes if x[2]), "stars", len(stars))
print("likes per flat", {f["key"]: likes_by.get(f["id"], 0) for f in flats}, "login:", best["owner"][0])
