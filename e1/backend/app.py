from flask import Flask, request, jsonify
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import struct

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///sensor_data.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

class SensorData(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    raw_payload = db.Column(db.String(100))
    temperature = db.Column(db.Float)
    humidity = db.Column(db.Float)
    pressure = db.Column(db.Float)

    def to_dict(self):
        return {
            'id': self.id,
            'timestamp': self.timestamp.isoformat(),
            'raw_payload': self.raw_payload,
            'temperature': self.temperature,
            'humidity': self.humidity,
            'pressure': self.pressure
        }

def decode_payload(hex_payload):
    hex_payload = hex_payload.strip().lower()
    if len(hex_payload) < 12:
        raise ValueError(f"Payload too short. Expected 12 hex chars, got {len(hex_payload)}")
    
    bytes_data = bytes.fromhex(hex_payload[:12])
    
    temperature = struct.unpack('>h', bytes_data[0:2])[0] / 100.0
    humidity = struct.unpack('>H', bytes_data[2:4])[0] / 10.0
    pressure = struct.unpack('>H', bytes_data[4:6])[0] / 10.0
    
    return {
        'temperature': round(temperature, 2),
        'humidity': round(humidity, 2),
        'pressure': round(pressure, 2)
    }

@app.route('/api/data', methods=['POST'])
def receive_data():
    try:
        data = request.get_json()
        if not data or 'payload' not in data:
            return jsonify({'error': 'No payload provided'}), 400
        
        hex_payload = data['payload']
        decoded = decode_payload(hex_payload)
        
        sensor_data = SensorData(
            raw_payload=hex_payload,
            temperature=decoded['temperature'],
            humidity=decoded['humidity'],
            pressure=decoded['pressure']
        )
        
        db.session.add(sensor_data)
        db.session.commit()
        
        return jsonify({
            'message': 'Data received and stored successfully',
            'decoded': decoded
        }), 201
        
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/api/data', methods=['GET'])
def get_data():
    try:
        limit = request.args.get('limit', default=100, type=int)
        sensor_data = SensorData.query.order_by(SensorData.timestamp.desc()).limit(limit).all()
        return jsonify([data.to_dict() for data in reversed(sensor_data)])
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/api/data/<int:data_id>', methods=['GET'])
def get_single_data(data_id):
    try:
        sensor_data = SensorData.query.get_or_404(data_id)
        return jsonify(sensor_data.to_dict())
    except Exception as e:
        return jsonify({'error': 'Data not found'}), 404

@app.route('/api/data/aggregate', methods=['GET'])
def get_aggregate_data():
    try:
        date_str = request.args.get('date')
        if not date_str:
            return jsonify({'error': 'Date parameter is required (YYYY-MM-DD)'}), 400
        
        try:
            date_obj = datetime.strptime(date_str, '%Y-%m-%d').date()
        except ValueError:
            return jsonify({'error': 'Invalid date format. Use YYYY-MM-DD'}), 400
        
        start_time = datetime.combine(date_obj, datetime.min.time())
        end_time = datetime.combine(date_obj, datetime.max.time())
        
        data = SensorData.query.filter(
            SensorData.timestamp >= start_time,
            SensorData.timestamp <= end_time
        ).all()
        
        if not data:
            return jsonify({
                'date': date_str,
                'count': 0,
                'temperature': {'avg': 0, 'min': 0, 'max': 0},
                'humidity': {'avg': 0, 'min': 0, 'max': 0},
                'pressure': {'avg': 0, 'min': 0, 'max': 0}
            })
        
        temperatures = [d.temperature for d in data]
        humidities = [d.humidity for d in data]
        pressures = [d.pressure for d in data]
        
        return jsonify({
            'date': date_str,
            'count': len(data),
            'temperature': {
                'avg': round(sum(temperatures) / len(temperatures), 2),
                'min': round(min(temperatures), 2),
                'max': round(max(temperatures), 2)
            },
            'humidity': {
                'avg': round(sum(humidities) / len(humidities), 2),
                'min': round(min(humidities), 2),
                'max': round(max(humidities), 2)
            },
            'pressure': {
                'avg': round(sum(pressures) / len(pressures), 2),
                'min': round(min(pressures), 2),
                'max': round(max(pressures), 2)
            }
        })
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    return response

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
    app.run(debug=True, host='0.0.0.0', port=5000)
