{{- define "sundhedmcp.name" -}}
{{- .Chart.Name | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "sundhedmcp.fullname" -}}
{{- if contains .Chart.Name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{- define "sundhedmcp.selectorLabels" -}}
app.kubernetes.io/name: {{ include "sundhedmcp.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "sundhedmcp.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{ include "sundhedmcp.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/* Pods with this label may reach the server despite the NetworkPolicy (helm test). */}}
{{- define "sundhedmcp.clientLabel" -}}
{{ include "sundhedmcp.fullname" . }}-client: "true"
{{- end }}

{{- define "sundhedmcp.mcpUrl" -}}
{{- printf "http://%s.%s.svc.cluster.local:%v/mcp" (include "sundhedmcp.fullname" .) .Release.Namespace .Values.service.port }}
{{- end }}

{{- define "sundhedmcp.apiTokenEnabled" -}}
{{- if or .Values.apiToken.enabled .Values.kagent.enabled }}true{{ end }}
{{- end }}

{{- define "sundhedmcp.passwordSecret" -}}
{{- .Values.adminPassword.existingSecret | default (printf "%s-admin" (include "sundhedmcp.fullname" .)) }}
{{- end }}

{{- define "sundhedmcp.apiTokenSecret" -}}
{{- .Values.apiToken.existingSecret | default (printf "%s-api-token" (include "sundhedmcp.fullname" .)) }}
{{- end }}

{{/* A random value kept across upgrades: the one already in the Secret, if any. */}}
{{- define "sundhedmcp.keptRandom" -}}
{{- $secret := lookup "v1" "Secret" .root.Release.Namespace .name }}
{{- if and $secret (index $secret.data .key) }}
{{- index $secret.data .key | b64dec }}
{{- else }}
{{- randAlphaNum .length }}
{{- end }}
{{- end }}

{{/*
The API token, the same in every template that renders it: from
existingSecret, else the one kept in the chart's Secret, else new. Cached on
.Values so the random one is drawn only once per render.
*/}}
{{- define "sundhedmcp.apiToken" -}}
{{- if not .Values._apiToken }}
{{- $name := include "sundhedmcp.apiTokenSecret" . }}
{{- $existing := lookup "v1" "Secret" .Release.Namespace $name }}
{{- if and $existing (index $existing.data .Values.apiToken.tokenKey) }}
{{- $_ := set .Values "_apiToken" (index $existing.data .Values.apiToken.tokenKey | b64dec) }}
{{- else if .Values.apiToken.existingSecret }}
{{- fail (printf "apiToken.existingSecret %s has no key %s (or helm cannot read it, as in helm template)" $name .Values.apiToken.tokenKey) }}
{{- else }}
{{- $_ := set .Values "_apiToken" (randAlphaNum 48) }}
{{- end }}
{{- end }}
{{- .Values._apiToken }}
{{- end }}

{{- define "sundhedmcp.validate" -}}
{{- if not (has .Values.storage.type (list "sqlite" "postgres" "none")) }}
{{- fail "storage.type must be sqlite, postgres or none" }}
{{- end }}
{{- if and (eq .Values.storage.type "postgres") (not .Values.storage.postgres.existingSecret) }}
{{- fail "storage.type postgres needs storage.postgres.existingSecret with the database URL" }}
{{- end }}
{{- if not (regexMatch "^https?://" .Values.baseUrl) }}
{{- fail "baseUrl must start with http:// or https://" }}
{{- end }}
{{- if and .Values.httpRoute.enabled (not .Values.httpRoute.parentRefs) }}
{{- fail "httpRoute needs parentRefs" }}
{{- end }}
{{- if and .Values.httpRoute.enabled (hasPrefix "http://localhost" .Values.baseUrl) }}
{{- fail "httpRoute needs baseUrl set to the public URL: OAuth and the MitID login page use it" }}
{{- end }}
{{- end }}
