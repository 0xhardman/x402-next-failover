# Publishing Guide

This guide explains how to publish `x402-failover` to npm using GitHub Actions with Trusted Publishers (OIDC authentication).

## Prerequisites

1. npm account with 2FA enabled
2. GitHub repository with push access
3. Project configured in package.json

## Setup Steps

### 1. Configure npm Trusted Publisher

1. Log in to [npmjs.com](https://www.npmjs.com/)
2. Navigate to your package page (or create it with first manual publish)
3. Go to **Settings** → **Publishing access**
4. Click **Add trusted publisher**
5. Fill in the form:
   - **Provider**: GitHub Actions
   - **GitHub repository owner**: `x402` (your GitHub username/org)
   - **Repository name**: `x402-failover`
   - **Workflow name**: `publish.yml`
   - **Environment name**: (leave empty)
6. Click **Add**

### 2. Verify GitHub Actions Workflow

The workflow file `.github/workflows/publish.yml` is already configured with:
- OIDC permissions (`id-token: write`)
- Provenance enabled (`--provenance` flag)
- Public access (`--access public`)

No GitHub secrets needed - authentication happens via OIDC.

### 3. Publishing Workflow

#### Automatic Publishing (Recommended)

1. Update version in `package.json`:
   ```bash
   npm version patch  # or minor, major
   ```

2. Push the version tag:
   ```bash
   git push && git push --tags
   ```

3. GitHub Actions will automatically:
   - Run build
   - Publish to npm with provenance
   - Authenticate via OIDC (no NPM_TOKEN needed)

#### Manual Publishing (First Time)

For the first publish, you must do it manually:

1. Build the project:
   ```bash
   npm run build
   ```

2. Publish with provenance:
   ```bash
   npm publish --provenance --access public
   ```

3. After first manual publish, configure Trusted Publisher on npm
4. Future publishes will work via GitHub Actions

## Version Strategy

We follow semantic versioning (semver):

- **Patch** (0.1.x): Bug fixes, no breaking changes
  ```bash
  npm version patch
  ```

- **Minor** (0.x.0): New features, backwards compatible
  ```bash
  npm version minor
  ```

- **Major** (x.0.0): Breaking changes
  ```bash
  npm version major
  ```

## Pre-Publish Checklist

Before creating a version tag:

- [ ] All tests pass (`npm test`)
- [ ] Build succeeds (`npm run build`)
- [ ] CLAUDE.md is up to date
- [ ] README.md reflects current features
- [ ] No uncommitted changes

## Troubleshooting

### "Package not found" during GitHub Actions

**Cause**: First publish must be manual
**Solution**: Publish manually once, then set up Trusted Publisher

### "Permission denied" during GitHub Actions

**Cause**: OIDC not configured on npm
**Solution**:
1. Go to npm package settings
2. Add GitHub as Trusted Publisher
3. Verify workflow name is `publish.yml`

### "Provenance generation failed"

**Cause**: Missing `id-token: write` permission
**Solution**: Already configured in workflow file, no action needed

### Build fails in GitHub Actions

**Cause**: Dependencies or TypeScript errors
**Solution**: Run locally first:
```bash
npm ci
npm run build
npm test
```

## Security Notes

- **No NPM_TOKEN needed**: OIDC authentication is more secure
- **Provenance enabled**: Provides supply chain security attestation
- **2FA required**: npm requires 2FA for publishing
- **Public package**: Uses `--access public` for scoped packages

## Manual Publish Instructions

If you need to publish manually:

1. Ensure you're logged in:
   ```bash
   npm whoami
   ```

2. Build and publish:
   ```bash
   npm run build
   npm publish --provenance --access public
   ```

3. Verify publication:
   ```bash
   npm view x402-failover
   ```

## References

- [npm Trusted Publishers Documentation](https://docs.npmjs.com/generating-provenance-statements)
- [GitHub OIDC Documentation](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect)
- [Semantic Versioning](https://semver.org/)
