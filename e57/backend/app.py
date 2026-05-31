from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import uuid
from pdb_parser import parse_pdb_file

app = Flask(__name__)
CORS(app)

UPLOAD_FOLDER = 'uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

@app.route('/api/parse-pdb', methods=['POST'])
def parse_pdb():
    if 'file' not in request.files:
        return jsonify({'success': False, 'error': 'No file uploaded'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'success': False, 'error': 'No file selected'}), 400
    
    if not file.filename.endswith('.pdb'):
        return jsonify({'success': False, 'error': 'File must be .pdb format'}), 400
    
    try:
        filename = f"{uuid.uuid4()}.pdb"
        file_path = os.path.join(UPLOAD_FOLDER, filename)
        file.save(file_path)
        
        molecule_data = parse_pdb_file(file_path)
        
        os.remove(file_path)
        
        return jsonify({
            'success': True,
            'data': molecule_data
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5000)
