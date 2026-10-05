import modal

app = modal.App("kicker")

@app.function()
def do_spawn():
    func = modal.Function.from_name("splicr-ingest", "process_private_screen")
    for _ in range(32):
        func.spawn()

@app.local_entrypoint()
def main():
    do_spawn.remote()
    print("Spawned 32 workers on Modal properly.")
