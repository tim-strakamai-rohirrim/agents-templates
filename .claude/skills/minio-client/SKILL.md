---
name: minio-client
description: |
  Connect to MinIO object storage via Azure AKS port-forward and browse/manage buckets.
  Triggers on "minio", "mc client", "object storage", "bucket", "minio logs",
  "browse minio", "minio files", "port-forward minio".
allowed-tools:
  - Bash
  - Read
---

# MinIO Client

Connect to MinIO object storage via AKS port-forward.

## Setup

### 1. Port-forward to MinIO
```bash
kubectl port-forward svc/minio 9000:9000 -n {namespace} &
```

### 2. Configure mc client
```bash
mc alias set rohan http://localhost:9000 {access-key} {secret-key}
```

## Common Operations

```bash
# List buckets
mc ls rohan/

# List files in bucket
mc ls rohan/{bucket-name}/

# Download file
mc cp rohan/{bucket-name}/{path} ./local-file

# Upload file
mc cp ./local-file rohan/{bucket-name}/{path}

# Get file info
mc stat rohan/{bucket-name}/{path}

# Search for files
mc find rohan/{bucket-name}/ --name "*.pdf"
```

## Troubleshooting
- If port-forward drops: re-run the port-forward command
- If access denied: check credentials with `mc admin info rohan`
- For large files: use `mc cp --continue` for resumable transfers
