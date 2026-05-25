import sqlite3
import re
import sys
from pathlib import Path

db_path = Path(sys.argv[1] if len(sys.argv) > 1 else "data/app.db")
if not db_path.exists():
    print("DB not found:", db_path)
    sys.exit(1)

con = sqlite3.connect(db_path)
con.row_factory = sqlite3.Row


def table_exists(name):
    return con.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
    ).fetchone()


def norm_lenient(phone):
    p = str(phone or "").strip().replace(" ", "").lstrip("+")
    if not p:
        return ""
    if p.startswith("254") and len(p) >= 12:
        return p
    if p.startswith("0") and len(p) >= 10:
        return "254" + p[1:]
    if re.match(r"^7\d{8}$", p):
        return "254" + p
    return p


def valid_2547(p):
    return bool(re.match(r"^2547\d{8}$", str(p or "")))


def section(title):
    print("\n" + "=" * 60)
    print(title)
    print("=" * 60)


for table in ("TopUp_SMS_Log", "Collection_Arrears_SMS_Log"):
    section(table)
    if not table_exists(table):
        print("(table missing)")
        continue

    rows = con.execute(
        f"""
        SELECT send_date, slot, status, COUNT(*) AS n
        FROM {table}
        GROUP BY send_date, slot, status
        ORDER BY send_date DESC, slot, status
        LIMIT 50
        """
    ).fetchall()
    print("By send_date / slot / status:")
    for r in rows:
        print(f"  {r['send_date']} {r['slot']} {r['status']}: {r['n']}")

    daily = con.execute(
        f"""
        SELECT send_date, COUNT(*) AS sent FROM {table}
        WHERE status='sent' GROUP BY send_date ORDER BY send_date DESC LIMIT 21
        """
    ).fetchall()
    print("\nDaily sent:")
    for r in daily:
        print(f"  {r['send_date']}: {r['sent']}")

    st = con.execute(
        f"""
        SELECT status, COUNT(*) AS n FROM {table}
        WHERE send_date >= date('now','-7 days') GROUP BY status
        """
    ).fetchall()
    print("\nLast 7 days by status:", [dict(r) for r in st])

    sent_phones = con.execute(
        f"""
        SELECT phone, COUNT(*) AS n FROM {table}
        WHERE status='sent' AND send_date >= date('now','-14 days')
        GROUP BY phone
        """
    ).fetchall()
    invalid = 0
    samples = []
    for r in sent_phones:
        n = norm_lenient(r["phone"])
        if not valid_2547(n):
            invalid += r["n"]
            if len(samples) < 8:
                samples.append({"phone": r["phone"], "norm": n, "n": r["n"]})
    print(f"\nSent (14d) failing strict 2547xxxxxxxx check: {invalid}")
    if samples:
        print("  samples:", samples)

    skipped = con.execute(
        f"""
        SELECT response, COUNT(*) AS n FROM {table}
        WHERE status='skipped' AND send_date >= date('now','-14 days')
        GROUP BY response ORDER BY n DESC LIMIT 10
        """
    ).fetchall()
    if skipped:
        print("\nSkipped reasons (14d):", [dict(r) for r in skipped])

section("Top-up pool (credit_scores)")
for t in ("credit_scores_boda", "credit_scores_zidisha"):
    if not table_exists(t):
        print(t, "missing")
        continue
    gs = con.execute(
        f"SELECT COUNT(*) AS n FROM {t} WHERE band IN ('Gold','Silver')"
    ).fetchone()["n"]
    no_phone = con.execute(
        f"""
        SELECT COUNT(*) AS n FROM {t}
        WHERE band IN ('Gold','Silver') AND (phone IS NULL OR TRIM(phone)='')
        """
    ).fetchone()["n"]
    phones = con.execute(
        f"SELECT phone FROM {t} WHERE band IN ('Gold','Silver')"
    ).fetchall()
    bad = sum(1 for r in phones if not valid_2547(norm_lenient(r["phone"])))
    print(f"{t}: Gold/Silver={gs}, no_phone={no_phone}, invalid_lenient={bad}")

def arrears_eligible_count(product_clause, extra_params):
    mp = ["advans emergency loan", "salary advans", "unsecured loans"]
    ph = ",".join("?" * len(mp))
    return con.execute(
        f"""
        SELECT COUNT(*) AS n FROM (
          SELECT TRIM("Client Id") AS cid
          FROM boda_Schedule
          WHERE date("Due Date") < date('now')
            AND (
              LOWER(COALESCE(TRIM("Product Name"), '')) NOT IN ({ph})
              OR date("Due Date") < date('now', '-15 day')
            )
            {product_clause}
          GROUP BY TRIM("Client Id"), TRIM("Client Name"), TRIM("Phone Number")
          HAVING SUM(COALESCE(CAST(REPLACE("Total Outstanding", ',', '') AS REAL), 0)) > 0
        )
        """,
        (*mp, *extra_params),
    ).fetchone()["n"]


section("Arrears eligible (schedule)")
if table_exists("boda_Schedule"):
    try:
        n_all = arrears_eligible_count("", [])
        n_boda = arrears_eligible_count(
            " AND LOWER(COALESCE(TRIM(\"Product Name\"), '')) = 'zidisha boda' ", []
        )
        print("Eligible arrears clients (all products):", n_all)
        print("Eligible arrears clients (Zidisha Boda only):", n_boda)
        mp = ["advans emergency loan", "salary advans", "unsecured loans"]
        ph = ",".join("?" * len(mp))
        by_prod = con.execute(
            f"""
            SELECT LOWER(TRIM("Product Name")) AS product,
                   COUNT(DISTINCT TRIM("Client Id")) AS clients
            FROM boda_Schedule
            WHERE date("Due Date") < date('now')
              AND (
                LOWER(COALESCE(TRIM("Product Name"), '')) NOT IN ({ph})
                OR date("Due Date") < date('now', '-15 day')
              )
            GROUP BY LOWER(TRIM("Product Name"))
            ORDER BY clients DESC LIMIT 12
            """,
            (*mp,),
        ).fetchall()
        print("By product:")
        for r in by_prod:
            print(f"  {r['product'] or '(blank)'}: {r['clients']}")
    except Exception as e:
        print("Error:", e)

con.close()
