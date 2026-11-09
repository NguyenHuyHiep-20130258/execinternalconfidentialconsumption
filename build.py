"""Build the page from src/ (and, locally, data/).

  PAGE_PASSWORD='...' python3 build.py [--with-data]
      -> index.html: the GitHub Pages site. The app is encrypted with the password
         (PBKDF2-SHA256 + AES-GCM); the password itself is never written to the repo.
         --with-data embeds data/seed.json inside the encrypted page, so the factory
         data is only readable after entering the password. Without PAGE_PASSWORD you are asked for it.
         SYNC_URL='https://script.google.com/macros/s/.../exec' adds sync through Google Sheets
         (apps-script/Code.gs); the URL is also kept inside the encrypted part.

  python3 build.py --artifact
      -> dist/artifact.html: page body for publishing as a Claude artifact,
         with data/seed.json embedded when that file exists (it is git-ignored).

  python3 build.py --gas
      -> dist/gas/index.html + dist/gas/Code.gs: the page served by Apps Script itself
         (HtmlService). Data comes from the Google Sheet; no data is embedded.

  python3 build.py --local
      -> dist/local.html: standalone page with data/seed.json, no password (git-ignored).
"""
import base64, getpass, json, os, sys

root = os.path.dirname(os.path.abspath(__file__))
rd = lambda *p: open(os.path.join(root, *p), encoding='utf-8').read()
EMPTY_SEED, EMPTY_ALIAS = '{"f1":{},"f2":{}}', '{}'


def page(with_data, sync='null'):
    seed, alias = EMPTY_SEED, EMPTY_ALIAS
    if with_data and os.path.exists(os.path.join(root, 'data', 'seed.json')):
        seed = rd('data', 'seed.json')
        alias = rd('data', 'alias.json') if os.path.exists(os.path.join(root, 'data', 'alias.json')) else EMPTY_ALIAS
    json.loads(seed); json.loads(alias)
    assert '</script' not in seed
    core = rd('src', 'core.js').replace("if (typeof module !== 'undefined') module.exports", "if (false) module.exports")
    return (rd('src', 'page.tmpl.html')
            .replace('/*SEED*/null', seed).replace('/*ALIAS*/null', alias).replace('/*SYNC*/null', sync)
            .replace('/*CORE*/', core).replace('/*APP*/', rd('src', 'app.js')))


def standalone(body):
    return ('<!DOCTYPE html>\n<html lang="vi">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
            '<meta name="robots" content="noindex, nofollow">\n</head>\n<body>\n' + body + '</body>\n</html>\n')


def write(rel, text):
    path = os.path.join(root, rel)
    os.makedirs(os.path.dirname(path) or root, exist_ok=True)
    open(path, 'w', encoding='utf-8').write(text)
    print(rel, len(text.encode()), 'bytes')


def pages():
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    import hashlib
    pw = os.environ.get('PAGE_PASSWORD') or getpass.getpass('Mật khẩu cho trang GitHub Pages: ')
    if not pw:
        sys.exit('Cần mật khẩu (biến môi trường PAGE_PASSWORD).')
    salt, iv, it = os.urandom(16), os.urandom(12), 600000
    key = hashlib.pbkdf2_hmac('sha256', pw.encode(), salt, it, 32)
    sync = json.dumps({'url': os.environ.get('SYNC_URL', '').strip(), 'token': pw})
    ct = AESGCM(key).encrypt(iv, standalone(page('--with-data' in sys.argv, sync)).encode('utf-8'), None)
    enc = lambda b: base64.b64encode(b).decode()
    payload = json.dumps({'salt': enc(salt), 'iv': enc(iv), 'iter': it, 'ct': enc(ct)})
    write('index.html', rd('src', 'gate.tmpl.html').replace('/*PAYLOAD*/null', payload))


if __name__ == '__main__':
    if '--gas' in sys.argv:
        write('dist/gas/index.html', standalone(page(False, '{"gas":true}')))
        write('dist/gas/Code.gs', rd('apps-script', 'Code.gs'))
    elif '--artifact' in sys.argv:
        write('dist/artifact.html', page(True))
    elif '--local' in sys.argv:
        write('dist/local.html', standalone(page(True)))
    else:
        pages()
