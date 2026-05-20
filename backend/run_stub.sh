#!/bin/bash
# Stub для sentence_transformers
cat > /tmp/sentence_stub.py << 'STUB'
class SentenceTransformer:
    def __init__(self, model_name):
        pass
    def encode(self, text):
        class Array:
            def tolist(self):
                return [0.0] * 384
        return Array()

import sys
sys.modules['sentence_transformers'] = type(sys)('sentence_transformers')
sys.modules['sentence_transformers'].SentenceTransformer = SentenceTransformer
STUB

export PYTHONPATH="/tmp:$PYTHONPATH"
python3 -c "exec(open('/tmp/sentence_stub.py').read())"
exec /root/.venv/bin/uvicorn server:app --host 0.0.0.0 --port 8001 --reload
