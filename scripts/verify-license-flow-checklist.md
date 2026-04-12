# Quick Cross-Role Verification Checklist (License Save/Submit)

Scope:
- Commercial License
- Environmental License
- Salamah License
- Taqyees License

## 1) Prep
- Login as a test user in each role:
  - Department employee
  - Department manager
  - Super admin
- Pick a valid station code that belongs to target department.
- Keep one browser profile per role to avoid token mix-ups.

## 2) Save Flow (Employee)
- Open each form.
- Enter partial data.
- Click Save.
- Expected:
  - Success toast/alert for save.
  - Record remains editable (draft state).
  - Re-open page after refresh/log out-log in: latest draft auto-loads.

## 3) Submit Flow (Employee)
- From saved draft, click Submit.
- Expected:
  - Success toast/alert for submit.
  - Draft id is cleared in UI.
  - Form resets for a new entry.
  - Submitted record appears in records list.

## 4) Resume Isolation (Employee)
- Save two drafts from two different users in same department.
- Re-open form as each user.
- Expected:
  - Each user only sees own latest draft.
  - No cross-user draft leakage.

## 5) Department Scope (Manager)
- Login as manager of Department A.
- Call list endpoints and check records from Department B are not returned.
- Expected:
  - Department-scoped filtering is applied.

## 6) Super Admin Scope
- Login as super admin.
- Open list views for all four modules.
- Expected:
  - Can see cross-department records.

## 7) API Smoke Commands (Manual)
Use role token in Authorization header.

### Commercial
- GET /api/commercial-licenses/latest-saved
- POST /api/commercial-licenses with submit=false
- PUT /api/commercial-licenses/:id with submit=true

### Environmental
- GET /api/government-licenses/environmental/latest-saved
- POST /api/government-licenses/environmental with submit=false
- PUT /api/government-licenses/environmental/:id with submit=true

### Salamah
- GET /api/government-licenses/salamah/latest-saved
- POST /api/government-licenses/salamah with submit=false
- PUT /api/government-licenses/salamah/:id with submit=true

### Taqyees
- GET /api/government-licenses/taqyees/latest-saved
- POST /api/government-licenses/taqyees with submit=false
- PUT /api/government-licenses/taqyees/:id with submit=true

## 8) Regression Checks
- Existing records still list correctly.
- Edit submitted records still works for authorized roles.
- No 500 errors in backend logs while saving/submitting.
- latest-saved returns null when no draft exists.
