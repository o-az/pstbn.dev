# [pstbn.dev](https://pstbn.dev)

Agent-first privacy-oriented pastebin service with CLI and HTTP support.

## Usage

### Create a paste

**POST** `/`

Plain text:

```sh
curl --request POST \
  --url "https://pstbn.dev" \
  --data "hello world"

# https://pstbn.dev/01KRYZZXC2JXWPH3AGQ30FEA28
```

With language hint:

```sh
curl --request POST \
  --url "https://pstbn.dev?lang=ts" \
  --data "const x: number = 42"

# https://pstbn.dev/01KRZ00PYGN4PS2CYG81TE7FXT
```

File upload (multipart):

```sh
curl --request POST \
  --url "https://pstbn.dev" \
  --form "file=@vite.config.ts"

# https://pstbn.dev/01KRZ0299F6K67N3GA614V6K2G
```

Returns the paste URL as plain text (status `201`).

**GET** `/create`

Via query parameter as text:

```sh
curl "https://pstbn.dev/create" \
  --url-query "content=hello world"

# https://pstbn.dev/01KRZ03KWDK2DA983SA52JAHBW
```

Via query parameter as text, with language hint:

```sh
curl "https://pstbn.dev/create" \
  --url-query "content=const x = 1" \
  --url-query "lang=ts"

# https://pstbn.dev/01KRZ04DEHANPCSDNFXVBHQTB3
```

Via query parameter as base64-encoded text:

```sh
ENCODED_CONTENT=$(echo -n "hello world" | base64)
curl "https://pstbn.dev/create" \
  --url-query "content=$ENCODED_CONTENT" \
  --url-query "encoding=base64"

# https://pstbn.dev/01KRZ094KC2P2T5Q50A564YWR5
```

### Get a paste

**GET** `/:id`

Get content as plain text:

```sh
curl "https://pstbn.dev/01KRZ094KC2P2T5Q50A564YWR5"
# hello world
```

Force a response format:

```sh
curl "https://pstbn.dev/01KMEND5TRZ5VCH7S0YXJFGJ8Y.json"
curl "https://pstbn.dev/01KMEND5TRZ5VCH7S0YXJFGJ8Y.txt"
curl "https://pstbn.dev/01KMEND5TRZ5VCH7S0YXJFGJ8Y.md"
```

Accept: application/json also returns the raw paste content as application/json:

```sh
curl "https://pstbn.dev/01KMEND5TRZ5VCH7S0YXJFGJ8Y" \
   --header "Accept: application/json"
```

Get metadata plus content as JSON:

```sh
curl "https://pstbn.dev/01KMEND5TRZ5VCH7S0YXJFGJ8Y?meta=true"
# {
#   "id": "01KMEND5TRZ5VCH7S0YXJFGJ8Y",
#   "size": 20,
#   "createdAt": "2026-03-24T00:55:07.352Z",
#   "language": "ts",
#   "contentType": "text/plain; charset=utf-8",
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
