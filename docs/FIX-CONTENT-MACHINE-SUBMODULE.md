# Fix: `content-machine` is a broken / empty submodule

## Fast fix (automated)

From **`silas-content-system/`** repo root:

```bash
chmod +x scripts/fix-content-machine-git.sh
./scripts/fix-content-machine-git.sh
git push
```

That script removes the submodule gitlink, deletes nested `content-machine/.git` if present, `git add`s the real Next.js files, and commits.

---

## Symptoms

- `git add content-machine/` from repo root → **nothing** staged; `git status` unchanged.
- Inside `content-machine/`: `git add .` → **`fatal: in unpopulated submodule 'content-machine'`**
- GitHub shows an **empty** `content-machine` folder (only a submodule pointer, no files).

The parent repo recorded `content-machine` as a **submodule** (special gitlink) instead of normal files. Until that is removed, Git will not track your Next.js source.

## Fix (make `content-machine` a normal folder — recommended)

Run from **`silas-content-system/`** repo root (not inside `content-machine/`):

```bash
cd /path/to/silas-content-system

# 1) Drop submodule registration (does not delete your project files on disk)
git submodule deinit -f content-machine 2>/dev/null || true
git rm --cached content-machine

# 2) Remove leftover submodule metadata (safe if paths missing)
rm -rf .git/modules/content-machine

# 3) If this folder was its own clone, remove the nested git metadata
#    (only if you want everything in ONE repo — backup first if unsure)
if [ -f content-machine/.git ]; then rm content-machine/.git; fi
if [ -d content-machine/.git ]; then rm -rf content-machine/.git; fi

# 4) Register as normal files
git add content-machine/

git status
# Expect: new/modified files under content-machine/ (package.json, src/, …)

git add README.md package.json
git commit -m "fix: track content-machine as normal directory (remove broken submodule)"
git push
```

## If you use `.gitmodules`

Open `.gitmodules` and **delete** the `[submodule "content-machine"]` block, then:

```bash
git add .gitmodules
```

## After fixing

- Install: `npm install --prefix content-machine`
- Run UI: `npm run dashboard`

Never run `git init` inside `content-machine/` if this app should live in the same repo as `silas-content-system`.
