# Phoenix Capital Executive Dashboard — System Description

## What It Is

The **Phoenix Capital Executive Dashboard** (Exco) is a **web-based operations and reporting platform** for Phoenix Capital. It brings together **loan operations, collections, disbursements, PAR (Portfolio at Risk), productivity, and HR** across multiple business lines in one place. Users log in once and see only what their role allows (e.g. Logbook, Zidisha, Boda, Advans, Data/Admin).

---

## In One Sentence

*“It’s a single dashboard where we see how much we’ve disbursed, how much we’ve collected, how much is at risk (PAR), and how staff and branches are performing—for Logbook, Zidisha, Boda, Advans, and related units, with role-based access and data we pull from our core systems (e.g. Loandisk, Musoni).”*

---

## Main Capabilities

| Area | What it does |
|------|-------------------------------|
| **Logbook** | Disbursements, collections, PAR, productivity, and demographics for Logbook (Loandisk) branches. Branch managers can be restricted to their branch. |
| **Zidisha** | Same kind of views for Zidisha products (Kifaru, Nyati, Simba, Tembo, Express), with branch filters and targets. |
| **Boda** | Dedicated Boda product views: disbursement, collection, PAR, and daily expected vs collected (Zidisha Boda only). |
| **Advans** | Dashboard, disbursement, collection, and productivity for Advans. |
| **Data / Admin** | User management, loan officers (LOs), branch targets, RO targets, Zidisha targets. Only admins/superusers. |
| **HR** | HR dashboard, demographics, departments, branches, contracts, directory, reports. |
| **Other** | Kajea (client counts), Insurance dashboard. |

---

## Who Uses It and How

- **Admins / Superusers**  
  Full access: all modules, Data section (users, branches, LOs, targets), and configuration.

- **Managers**  
  Access to one or more modules (Logbook, Zidisha, Boda, Advans) with optional branch restrictions; no Data section unless also admin.

- **Logbook / Zidisha / Boda / Advans roles**  
  Access only to their assigned module(s), often scoped by branch (e.g. branch manager sees only their branch).

- **Custom role**  
  Access to specific pages/modules and branches as configured by an admin.

So when you tell someone: *“Managers and branch staff use it to see their disbursements, collections, PAR, and productivity; admins use it to manage users, branches, and targets.”*

---

## Where the Data Comes From

- **Logbook (Loandisk)**  
  A script (`scripts/fetch_disbursments.mjs`) pulls disbursements, collections, and borrowers from the Loandisk API into SQLite. Data is stored in tables like `Logbook_Disbursement`, `Logbook_collection`, `Logbook_borrowers`. PAR data is also ingested and stored.

- **Zidisha**  
  Zidisha data (e.g. from Musoni/export) is ingested into `zidisha_data`. A separate “Zidisha Daily” export feeds the Boda daily expected vs collected and related views.

- **Boda**  
  Uses Zidisha Boda–only data from `zidisha_data` and `Zidisha_Daily`, plus a boda repayments table where applicable.

- **HR / Kajea / Insurance**  
  Their own data sources and APIs as configured (e.g. HR systems, Kajea, insurance).

So you can say: *“Data is synced from our core systems (Loandisk for Logbook, Musoni/exports for Zidisha/Boda) into our own database, and the dashboard reads from that so we have one place to report and monitor.”*

---

## Tech in Short

- **Frontend:** React (Vite), React Router, Tailwind CSS, Recharts, Lucide icons.
- **Backend:** Node.js (Express), SQLite (better-sqlite3), JWT in HTTP-only cookies for auth.
- **Data ingestion:** Node scripts (e.g. `fetch_disbursments.mjs`) that call external APIs and write to SQLite.
- **Deployment:** Can run with `node server.js`; also PM2 and optional cron for ingestion.

So: *“React front end, Node/Express API, SQLite database, and scripts that pull data from Loandisk and other systems.”*

---

## How to Describe It to Someone

**Short (e.g. to a new colleague):**  
*“It’s our internal dashboard for loan operations: we see disbursements, collections, PAR, and productivity for Logbook, Zidisha, Boda, and Advans. You log in and only see the parts you’re allowed to; branch people see their branch, admins see everything and manage users and targets.”*

**Slightly longer (e.g. to IT or a partner):**  
*“We have a web app that aggregates data from Loandisk and our Zidisha/Musoni exports into a SQLite database. The app shows dashboards, disbursement and collection views, PAR, and staff productivity by product and branch. Access is role-based: some users only see Logbook, others only Zidisha or Boda, and branch managers can be limited to their branch. Admins manage users, branches, loan officers, and targets (branch targets, RO targets, Zidisha targets) from the same system.”*

**For management:**  
*“Single dashboard for monitoring and reporting across our lending units (Logbook, Zidisha, Boda, Advans). It shows how much we disbursed and collected, what’s at risk (PAR), and how branches and staff are performing. Data is fed from our core systems; access is controlled by role and branch so people only see what they need.”*

---

## Quick Reference

| Term | Meaning |
|------|--------|
| **Exco** | This system (Executive Dashboard). |
| **Logbook** | Lending operations using Loandisk (disbursements, collections, PAR). |
| **Zidisha** | Zidisha product line (Kifaru, Nyati, Simba, Tembo, Express). |
| **Boda** | Zidisha Boda product; has its own disbursement/collection/PAR views. |
| **PAR** | Portfolio at Risk (e.g. overdue / at-risk exposure). |
| **RO Targets** | Targets per loan officer (used in Productivity). |
| **Data module** | Admin-only: users, branches, LOs, Logbook/Zidisha/RO targets. |

You can share this file or copy the “How to describe it” sections when explaining the system to someone.
