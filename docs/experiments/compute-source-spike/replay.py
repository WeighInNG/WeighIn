"""Replay the temporary native feasibility helper against saved real snapshots."""
import copy
import json
from pathlib import Path
import subprocess
import sys

evidence = Path(__file__).resolve().parent
helper = Path(sys.argv[1]).resolve()


def read(name):
    return json.loads((evidence / (name + '.json')).read_text())


def invoke(data):
    process = subprocess.run([str(helper)], input=json.dumps(data), text=True,
                             capture_output=True, timeout=30, check=True)
    output = json.loads(process.stdout)
    for key in ('cpu_instructions_consumed', 'memory_bytes_consumed',
                'instruction_budget', 'disk_read_bytes', 'write_bytes'):
        if type(output.get(key)) is not int or output[key] < 0:
            raise ValueError('Invalid or missing ' + key)
    return output


inputs = {label: read(label + '-input') for label in ('base', 'head')}
for key in ('header_xdr', 'entries', 'seed', 'network_passphrase'):
    assert inputs['base'][key] == inputs['head'][key], key

outputs = {}
for label, data in inputs.items():
    expected = read(label + '-output')
    runs = [invoke(data) for _ in range(5)]
    assert all(result == expected for result in runs), label + ' repeatability'
    outputs[label] = runs[0]
    raw = read(label + '-rpc')['raw']['result']
    assert expected['transaction_data_xdr'] == raw['transactionData']
    assert expected['retval_xdr'] == raw['results'][0]['xdr']
    altered = copy.deepcopy(data)
    altered['instruction_leeway'] = 5_000_000
    leeway = invoke(altered)
    assert leeway == read(label + '-leeway-output')
    for key in ('cpu_instructions_consumed', 'memory_bytes_consumed'):
        assert leeway[key] == expected[key], key
    assert leeway['instruction_budget'] > expected['instruction_budget']

cpu = outputs['head']['cpu_instructions_consumed'] - outputs['base']['cpu_instructions_consumed']
memory = outputs['head']['memory_bytes_consumed'] - outputs['base']['memory_bytes_consumed']
assert cpu > 0 and memory > 0
print(json.dumps({'status': 'SNAPSHOT_REPLAY_PASS', 'runs_per_revision': 5,
                  'cpu_delta': cpu, 'memory_delta': memory,
                  'rpc_transaction_data_parity': True,
                  'leeway_independent_consumption': True,
                  'production_integration_proven': False}, indent=2))
