# UNTangle

Schedule optimizing full-stack app — Next.js frontend + Django backend.

## Structure

- **frontend/** — Next.js TypeScript app (main UI)
- **backend/** — Django API ([UNT-Schedule-Optimizer](https://github.com/sunnyD1000/UNT-Schedule-Optimizer) submodule)

## Setup

```bash
# Install deps
bun install

# Backend (Django)
cd backend && pip install -r requirements.txt  # if exists
python manage.py runserver

# Frontend
bun run dev
```

## Turborepo

```bash
bun run dev   # runs frontend dev
bun run build # builds frontend
```
