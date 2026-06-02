---
name: azure-logs
description: |
  Pull live logs from any service (UI, API, Python API) in any Azure AKS environment
  (staging, prod, client). Flexible debugging without touching local config.
  Triggers on "azure logs", "logs", "staging logs", "prod logs", "client logs",
  "debug logs", "check errors".
allowed-tools:
  - Bash
  - Read
---

# Azure Logs

Pull live logs from Azure AKS services for debugging.

## Prerequisites
- `az` CLI authenticated (`az login`)
- `kubectl` configured for the target cluster

## Usage

### 1. Select Environment
Ask which environment if not specified:
- **staging**: `rohan-staging`
- **prod**: `rohan-prod`
- **client**: client-specific cluster name

### 2. Connect to Cluster
```bash
az aks get-credentials --resource-group {rg} --name {cluster} --overwrite-existing
```

### 3. Get Pods
```bash
kubectl get pods -n {namespace} | grep {service}
```

### 4. Tail Logs
```bash
# Last 100 lines
kubectl logs {pod-name} -n {namespace} --tail=100

# Follow live
kubectl logs {pod-name} -n {namespace} -f

# Filter for errors
kubectl logs {pod-name} -n {namespace} --tail=500 | grep -i error
```

### Services
| Service | Namespace | Pod Prefix |
|---------|-----------|------------|
| UI | default | rohan-ui |
| API | default | rohan-api |
| Python API | default | rohan-python-api |
