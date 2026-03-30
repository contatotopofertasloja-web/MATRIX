"""
Seed: importa todas as localidades do Brasil (archive.zip) para
03_prospecta.localidades no Supabase via REST API em lotes.
"""

import zipfile, csv, io, os, json, urllib.request, urllib.error

# ── Credenciais ──────────────────────────────────────────────────────────────
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://tbapcaxbawruijrigafn.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRiYXBjYXhiYXdydWlqcmlnYWZuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTcxODc1MSwiZXhwIjoyMDg1Mjk0NzUxfQ.6GxdNEtzVcqFuk2BFMCKAMjbvv_v1u6hgX3jIobddqQ")
ZIP_PATH     = r"C:\Users\Vandeir Scheffelt\Downloads\archive.zip"
BATCH_SIZE   = 500
SCHEMA       = "03_prospecta"
TABLE        = "localidades"

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=ignore-duplicates,return=minimal",  # ignora duplicatas
}

URL = f"{SUPABASE_URL}/rest/v1/{TABLE}?on_conflict=termo_busca"

def post_batch(rows):
    data = json.dumps(rows).encode("utf-8")
    req  = urllib.request.Request(URL, data=data, headers=HEADERS, method="POST")
    req.add_header("Accept-Profile", SCHEMA)
    req.add_header("Content-Profile", SCHEMA)
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status
    except urllib.error.HTTPError as e:
        print(f"  ❌ HTTP {e.code}: {e.read().decode()}")
        return e.code

def main():
    print(f"📂 Lendo {ZIP_PATH}...")
    z = zipfile.ZipFile(ZIP_PATH)

    arquivos = [n for n in z.namelist() if n != "data_BR_all_all.csv"]
    print(f"   {len(arquivos)} arquivos de estado encontrados.\n")

    total_inserido = 0
    total_erros    = 0
    batch          = []

    for arquivo in sorted(arquivos):
        estado_sigla = arquivo.split("_")[2]  # data_BR_SP_all.csv → SP
        print(f"  📍 Processando {arquivo} ({estado_sigla})...")

        with z.open(arquivo) as f:
            reader = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8"))
            for row in reader:
                cidade = (row.get("city") or "").strip()
                bairro = (row.get("location_name") or "").strip()
                if not cidade or not bairro:
                    continue

                termo = f"{bairro}, {cidade}, {estado_sigla}"
                batch.append({
                    "pais_codigo": "BR",
                    "estado":      estado_sigla,
                    "cidade":      cidade,
                    "bairro":      bairro,
                    "termo_busca": termo,
                    "status":      "pendente",
                })

                if len(batch) >= BATCH_SIZE:
                    status = post_batch(batch)
                    if status in (200, 201):
                        total_inserido += len(batch)
                        print(f"    ✅ Lote de {len(batch)} enviado. Total: {total_inserido}")
                    else:
                        total_erros += len(batch)
                    batch = []

    # Lote final
    if batch:
        status = post_batch(batch)
        if status in (200, 201):
            total_inserido += len(batch)
            print(f"    ✅ Lote final de {len(batch)} enviado. Total: {total_inserido}")
        else:
            total_erros += len(batch)

    print(f"\n🎉 CONCLUÍDO!")
    print(f"   Inseridos: {total_inserido}")
    print(f"   Erros:     {total_erros}")

if __name__ == "__main__":
    main()
