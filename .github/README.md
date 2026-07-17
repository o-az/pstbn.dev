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

Using CLI with `npx pstbn.dev`:

```sh
npx --yes pstbn.dev@latest create --content "hello world"
# url: "https://pstbn.dev/01KS3W2NNZ479V5RXMEPGSMS4E"

npx --yes pstbn.dev@latest create --content "const x = 1" --language ts
# url: "https://pstbn.dev/01KS3W2STR416NY0Z7FFT0F79M"

npx --yes pstbn.dev@latest create --file ./video.mp4
# url: "https://pstbn.dev/01KS3W3A3BC4ZFB2Y0G2D2W11R"
```

Multipart uploads accept up to 10 entries. A single entry is stored directly, while multiple entries are bundled into one ZIP paste by default:

```sh
curl "https://pstbn.dev" \
  --form "video=@video.mp4;type=video/mp4" \
  --form "image=@image.png;type=image/png"

# https://pstbn.dev/01KS3W4F38YM2DS8KSV8QAGX8R
```

Use `zip=true` to ZIP a single entry, or `zip=false` to create one paste per entry:

```sh
curl "https://pstbn.dev?zip=true" \
  --form "video=@video.mp4;type=video/mp4"

curl "https://pstbn.dev?zip=false" \
  --form "video=@video.mp4;type=video/mp4" \
  --form "image=@image.png;type=image/png"

# https://pstbn.dev/01KS3W4YQ7BNGE60BB0MXVMSVR
# https://pstbn.dev/01KS3W4YQ7BNGE60BB0MXVMSVS
```

Public and multipart uploads are limited to 25 MiB, including multipart framing. A valid API key raises the limit for raw, non-multipart uploads to 100 MB and uses the rate limit attached to that key:

```sh
curl --request POST \
  --url "https://pstbn.dev" \
  --header "Authorization: Bearer $PSTBN_API_KEY" \
  --header "Content-Type: video/mp4" \
  --data-binary "@video.mp4"
```

Without an API key, uploads use the public IP-based rate limit. If an `Authorization` header is supplied, it must contain a valid Bearer API key.

Returns the paste URL or URLs as plain text (status `201`).

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

Using the CLI with `npx --yes pstbn.dev`:

```sh
npx --yes pstbn.dev@latest get 01KS3W2NNZ479V5RXMEPGSMS4E
# content: hello world
```

Force a response format:

```sh
curl "https://pstbn.dev/01KRZ0C4HPPVG1589JE7S8TMQH.json"
curl "https://pstbn.dev/01KMEND5TRZ5VCH7S0YXJFGJ8Y.txt"
curl "https://pstbn.dev/01KMEND5TRZ5VCH7S0YXJFGJ8Y.md"
```

`"Accept: application/json"` also returns the raw paste content as `application/json`:

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

Using the CLI with `npx --yes pstbn.dev`:

```sh
npx --yes pstbn.dev@latest get 01KS3W2STR416NY0Z7FFT0F79M --meta
# id: 01KS3W2STR416NY0Z7FFT0F79M
# size: 11
# createdAt: "2026-05-20T23:38:37.784Z"
# language: ts
# contentType: text/plain
# content: const x = 1
```

### List pastes

**GET** `/list`

```sh
curl "https://pstbn.dev/list"
curl "https://pstbn.dev/list?limit=5"
curl "https://pstbn.dev/list?limit=5&cursor=<cursor>"
```

Using the CLI with `npx --yes pstbn.dev`:

```sh
npx --yes pstbn.dev@latest list --limit 1
# pastes[1]{id,language,size,createdAt}:
#   01KMB1K3WM0PQ0F2WRD1V462XJ,null,19,"2026-03-22T15:11:07.156Z"
# cursor: AAAA...
```

### Health check

```sh
curl "https://pstbn.dev/health"
# ok
```

### API docs & schema

- Interactive docs: <https://pstbn.dev/docs>
- OpenAPI schema: <https://pstbn.dev/openapi.json>
