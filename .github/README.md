# [pstbn.dev](https://pstbn.dev)

Agent-first privacy-oriented pastebin service with CLI and HTTP support.

## Usage

### Create a paste

**POST** `/`

```sh
# Plain text
curl --request POST \
  --url "https://pstbn.dev" \
  --data "hello world"
# https://pstbn.dev/01KMEND534DJFKS65C2HTC5VBB
```

```sh
# With language hint
curl --request POST \
  --url "https://pstbn.dev?lang=ts" \
  --data "const x: number = 42"
# https://pstbn.dev/01KMEND5TRZ5VCH7S0YXJFGJ8Y
```

```sh
# File upload (multipart)
curl --request POST \
  --url "https://pstbn.dev" \
  --form "file=@screenshot.png"
# https://pstbn.dev/01KMEND6DR73ESR8MNVH9KCHWA
```

Returns the paste URL as plain text (status `201`).

**GET** `/create`

```sh
# Via query parameter as text
curl "https://pstbn.dev/create" \
  --url-query "content=hello world"
```

```sh
curl "https://pstbn.dev/create" \
  --url-query "content=const x = 1" \
  --url-query "lang=ts"
```

```sh
# Via query parameter as base64-encoded text
curl "https://pstbn.dev/create" \
  --url-query "content=aGVsbG8=" \
  --url-query "encoding=base64"
```

### Get a paste

**GET** `/:id`

```sh
# Get content as plain text
curl "https://pstbn.dev/01KMEND534DJFKS65C2HTC5VBB"
# hello world
```

```sh
# Get metadata as JSON
curl "https://pstbn.dev/01KMEND5TRZ5VCH7S0YXJFGJ8Y" \
   --header "Accept: application/json"
# {
#   "id": "01KMEND5TRZ5VCH7S0YXJFGJ8Y",
#   "size": 20,
#   "createdAt": "2026-03-24T00:55:07.352Z",
#   "language": "ts",
#   "contentType": "application/x-www-form-urlencoded",
#   "content": "const x: number = 42"
# }
```

### List pastes

**GET** `/list`

```sh
curl "https://pstbn.dev/list"
curl "https://pstbn.dev/list?limit=5"
curl "https://pstbn.dev/list?limit=5&cursor=<cursor>"
```

### Health check

```sh
curl "https://pstbn.dev/health"
# ok
```

### API docs & schema

- Interactive docs: <https://pstbn.dev/docs>
- OpenAPI schema: <https://pstbn.dev/openapi.json>
