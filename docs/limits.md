# MVP support matrix

| Area | Supported | Explicitly unsupported / behavior |
| --- | --- | --- |
| Import | Local JSON/YAML OpenAPI 3.0.x and 3.1.x, at most 5 MiB | Swagger 2, OpenAPI 3.2, URL imports; convert/download locally first |
| References | Non-recursive local `#/...` refs | External refs, cycles, `$ref` siblings beyond summary/description; bundle externally first |
| Manual endpoints | Method, path, description, parameters, JSON body schema; simple onboarding starts with one GET path and inferred text placeholders | Static headers/secret literals, scripts, templating, arbitrary parameter mapping |
| Methods | GET, HEAD, OPTIONS, POST, PUT, PATCH, DELETE | TRACE; GET/HEAD bodies |
| Server | One explicit absolute HTTP(S) base URL per source, base paths retained | Path/operation server overrides; unresolved server variables; no implicit server selection |
| Path | Required scalar string/integer/number/boolean, simple style, percent encoding | Arrays, objects, null, dot-segment values, literal query/fragment/backslash in operation paths |
| Query | Scalar types; arrays of scalar items, form style; explode true repeats keys; false joins comma-free items with commas | Objects, deepObject, spaceDelimited, pipeDelimited, content parameters, allowReserved/allowEmptyValue |
| Headers | Scalar types, simple style | Cookie parameters, Authorization, Proxy-Authorization, Cookie, Host, connection/framing and Content-Type headers; configure auth separately |
| Bodies | A single application/json media type; typed objects, arrays and scalars | Multipart, form data, binary, multiple request media types |
| Schemas | Explicit types, nested properties/items/additionalProperties, required, enum/const, string/numeric/array/object constraints and known Ajv formats | Composition (allOf/oneOf/anyOf/not), discriminator, recursive definitions, boolean schemas, unevaluated keywords, readOnly input fields, custom dialects/unknown keywords |
| Dialect | Generated JSON Schema 2020-12; OpenAPI 3.0 nullable and exclusive bound conversion | Arbitrary JSON Schema dialects; no implicit defaults/coercion; property names constructor/prototype/__proto__ rejected |
| Auth | Source-wide bearer, API key in header or query; runtime env values | OAuth, Basic, cookies, scoped/combined security, per-operation credentials; unsupported alternatives conservatively reject the operation |
| Responses | JSON and text, including empty/204 and application/*+json; at most 1 MiB | Binary/media outputs, streaming, output schema validation, automatic pagination; errors at call time for unsupported response types |
| Reliability | Total timeout 1–300000 ms, default 10000; cancellation; no retries | No automatic retries for any method; no redirect following |
| Dashboard | Local project/source discovery, persistent tool switches, source settings and session animation preference | No live request monitor, external client-config import, cross-process hot reload or global project registry |
| MCP | Official SDK 1.32.1 stdio, list/call tools, advisory read/write annotations | Modern protocol era from SDK v2, HTTP transport, resources/prompts, OAuth, hot reload |
| Client export | MCP Inspector 2.10.1 CLI, legacy protocol era | Desktop-client installation/testing; export contains absolute machine-specific paths and no credentials |

Descriptions/default/examples are metadata, not request values. Unsupported
schema keywords are never silently removed. Nullable scalar path/query/header
parameters are rejected because HTTP null serialization is not defined here.
Object body fields may be nullable when represented by supported schema types.
`readOnly: true` request properties are rejected instead of silently omitted.

OpenAPI errors at document level fail the whole source. Unsupported operation
features create a catalog entry with the operation id and reason. Unselected
unsupported entries do not prevent a useful subset from running; `validate
--strict` fails for any such entry. Response schema definitions are validated as
part of the source document but are not converted to MCP output schemas.

API-key parameters that also appear in the operation input are rejected for a
selected tool. Remove them from its OpenAPI parameters and express them through
securitySchemes and source auth. Authentication is never a tool argument.

These constraints deliberately keep the runtime small. They are limitations,
not claims that every valid OpenAPI document can be imported.

Simple onboarding needs a local OpenAPI file or a documented API address and
GET path. It does not discover endpoints from a website, infer body/query types
from response samples, or use an LLM. The full manual configuration and `add`
wizard remain available for more complex requests.
