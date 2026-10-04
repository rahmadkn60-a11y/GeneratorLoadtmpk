export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders()
      });
    }

    if (
      url.pathname === "/api/upload" &&
      request.method === "POST"
    ) {
      return handleUpload(request, env);
    }

    return json(
      {
        error: "Not Found"
      },
      404
    );
  }
};


async function handleUpload(request, env) {
  try {
    /*
     * GitHub token harus disimpan sebagai
     * Cloudflare Secret bernama GITHUB_TOKEN.
     */

    if (!env.GITHUB_TOKEN) {
      return json(
        {
          error:
            "GITHUB_TOKEN belum dikonfigurasi."
        },
        500
      );
    }


    /*
     * Repository dikunci di server.
     *
     * Browser tidak bisa menentukan repository
     * tujuan upload.
     */

    const OWNER =
      "rahmadkn60-a11y";

    const REPOSITORY =
      "BUATSCRIPT";


    const body =
      await request.json();


    const code =
      typeof body.code === "string"
        ? body.code
        : "";


    if (!code.trim()) {
      return json(
        {
          error:
            "Source code tidak boleh kosong."
        },
        400
      );
    }


    /*
     * Batas ukuran source code.
     *
     * Bisa kita sesuaikan nanti.
     */

    const MAX_CODE_SIZE =
      2 * 1024 * 1024;


    if (code.length > MAX_CODE_SIZE) {
      return json(
        {
          error:
            "Source code terlalu besar."
        },
        413
      );
    }


    /*
     * Generate nama file acak.
     *
     * Contoh:
     *
     * K7xP2mQa.lua
     */

    const filename =
      await generateAvailableFilename(
        OWNER,
        REPOSITORY,
        env.GITHUB_TOKEN
      );


    /*
     * Encode source code sebagai Base64.
     */

    const contentBase64 =
      uint8ToBase64(
        new TextEncoder().encode(code)
      );


    /*
     * Upload file baru.
     */

    const githubUrl =
      buildGithubContentsUrl(
        OWNER,
        REPOSITORY,
        filename
      );


    const uploadResponse =
      await fetch(
        githubUrl,
        {
          method: "PUT",

          headers:
            githubHeaders(
              env.GITHUB_TOKEN
            ),

          body: JSON.stringify({
            message:
              `Upload ${filename}`,

            content:
              contentBase64
          })
        }
      );


    const uploadData =
      await uploadResponse.json();


    if (!uploadResponse.ok) {

      return json(
        {
          error:
            uploadData.message ||
            "GitHub upload gagal."
        },
        uploadResponse.status
      );
    }


    /*
     * GitHub menyediakan download_url.
     */

    const rawUrl =
      uploadData.content?.download_url ||
      buildRawUrl(
        OWNER,
        REPOSITORY,
        filename
      );


    if (!rawUrl) {
      return json(
        {
          error:
            "Raw URL tidak berhasil dibuat."
        },
        502
      );
    }


    /*
     * Hasil akhir.
     */

    const loadstring =
      `loadstring(game:HttpGet("${rawUrl}"))()`;


    return json({
      success: true,

      filename,

      repository:
        `${OWNER}/${REPOSITORY}`,

      rawUrl,

      loadstring
    });


  } catch (error) {

    console.error(error);

    return json(
      {
        error:
          error?.message ||
          "Internal server error."
      },
      500
    );
  }
}


/*
 * Generate nama acak dan pastikan
 * belum digunakan di repository.
 */

async function generateAvailableFilename(
  owner,
  repository,
  token
) {

  const MAX_ATTEMPTS = 20;


  for (
    let attempt = 0;
    attempt < MAX_ATTEMPTS;
    attempt++
  ) {

    const randomName =
      randomString(12) + ".lua";


    const exists =
      await githubFileExists(
        owner,
        repository,
        randomName,
        token
      );


    if (!exists) {
      return randomName;
    }
  }


  throw new Error(
    "Gagal mendapatkan nama file unik."
  );
}


/*
 * Mengecek apakah file sudah ada.
 */

async function githubFileExists(
  owner,
  repository,
  filename,
  token
) {

  const url =
    buildGithubContentsUrl(
      owner,
      repository,
      filename
    );


  const response =
    await fetch(
      url,
      {
        method: "GET",

        headers:
          githubHeaders(token)
      }
    );


  if (response.status === 404) {
    return false;
  }


  if (response.ok) {
    return true;
  }


  const text =
    await response.text();


  throw new Error(
    `GitHub check gagal: ${text}`
  );
}


/*
 * Membuat random string menggunakan
 * Web Crypto API.
 */

function randomString(length) {

  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZ" +
    "abcdefghijkmnopqrstuvwxyz" +
    "23456789";


  const randomBytes =
    new Uint8Array(length);


  crypto.getRandomValues(
    randomBytes
  );


  let result = "";


  for (
    let i = 0;
    i < length;
    i++
  ) {

    result +=
      alphabet[
        randomBytes[i] %
        alphabet.length
      ];
  }


  return result;
}


/*
 * GitHub Contents API URL.
 */

function buildGithubContentsUrl(
  owner,
  repository,
  filename
) {

  const encodedPath =
    filename
      .split("/")
      .map(
        part =>
          encodeURIComponent(part)
      )
      .join("/");


  return (
    "https://api.github.com/repos/" +
    encodeURIComponent(owner) +
    "/" +
    encodeURIComponent(repository) +
    "/contents/" +
    encodedPath
  );
}


/*
 * Raw GitHub URL.
 */

function buildRawUrl(
  owner,
  repository,
  filename
) {

  const encodedPath =
    filename
      .split("/")
      .map(
        part =>
          encodeURIComponent(part)
      )
      .join("/");


  return (
    "https://raw.githubusercontent.com/" +
    encodeURIComponent(owner) +
    "/" +
    encodeURIComponent(repository) +
    "/HEAD/" +
    encodedPath
  );
}


/*
 * GitHub API headers.
 */

function githubHeaders(token) {

  return {
    "Authorization":
      `Bearer ${token}`,

    "Accept":
      "application/vnd.github+json",

    "X-GitHub-Api-Version":
      "2022-11-28",

    "User-Agent":
      "Cloudflare-Auto-Uploader",

    "Content-Type":
      "application/json"
  };
}


/*
 * Uint8Array -> Base64.
 *
 * Aman untuk UTF-8.
 */

function uint8ToBase64(bytes) {

  let binary = "";

  const CHUNK_SIZE =
    0x8000;


  for (
    let i = 0;
    i < bytes.length;
    i += CHUNK_SIZE
  ) {

    const chunk =
      bytes.subarray(
        i,
        Math.min(
          i + CHUNK_SIZE,
          bytes.length
        )
      );


    binary +=
      String.fromCharCode(
        ...chunk
      );
  }


  return btoa(binary);
}


/*
 * JSON response.
 */

function json(
  data,
  status = 200
) {

  return new Response(
    JSON.stringify(data),
    {
      status,

      headers: {
        ...corsHeaders(),

        "Content-Type":
          "application/json; charset=utf-8"
      }
    }
  );
}


/*
 * CORS headers.
 */

function corsHeaders() {

  return {
    "Access-Control-Allow-Origin":
      "*",

    "Access-Control-Allow-Methods":
      "POST, OPTIONS",

    "Access-Control-Allow-Headers":
      "Content-Type"
  };
}
