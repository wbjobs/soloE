from flask import Flask, request, jsonify
import joblib
import os
import numpy as np

app = Flask(__name__)

MODEL_PATH = 'sentiment_model.pkl'

model = None

def load_model():
    global model
    if os.path.exists(MODEL_PATH):
        model = joblib.load(MODEL_PATH)
        print("Model loaded successfully!")
    else:
        raise FileNotFoundError(f"Model file {MODEL_PATH} not found. Please run train_model.py first.")

def preprocess_text(text):
    text = text.strip()
    if len(text) == 0:
        return None
    return text

def has_valid_features(text, model):
    try:
        tfidf = model.named_steps['tfidf']
        transformed = tfidf.transform([text])
        return transformed.nnz > 0
    except:
        return False

def predict_single_sentiment(text):
    result = {
        'text': text,
        'sentiment': 'unknown',
        'confidence': 0.0,
        'error': None
    }
    
    if not isinstance(text, str):
        result['error'] = 'Text must be a string'
        return result
    
    processed_text = preprocess_text(text)
    if processed_text is None:
        result['error'] = 'Text cannot be empty or whitespace only'
        return result
    
    if not has_valid_features(processed_text, model):
        result['error'] = 'Text does not contain enough meaningful words for analysis'
        return result
    
    try:
        prediction = model.predict([processed_text])[0]
        probabilities = model.predict_proba([processed_text])[0]
    except ValueError as e:
        if 'np.nan' in str(e) or 'empty' in str(e).lower():
            result['error'] = 'Could not extract meaningful features from text'
            return result
        raise
    
    if prediction is None or (isinstance(prediction, float) and np.isnan(prediction)):
        result['error'] = 'Could not determine sentiment for the given text'
        return result
    
    class_index = model.classes_.tolist().index(prediction)
    confidence = float(probabilities[class_index])
    
    if np.isnan(confidence):
        confidence = 0.0
    
    result['sentiment'] = prediction
    result['confidence'] = round(confidence, 4)
    return result

@app.route('/api/sentiment', methods=['POST'])
def analyze_sentiment():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({
                'error': 'Missing request body'
            }), 400
        
        if 'text' in data:
            text = data['text']
            result = predict_single_sentiment(text)
            
            if result['error']:
                return jsonify({
                    'error': result['error'],
                    'text': text,
                    'sentiment': 'unknown',
                    'confidence': 0.0
                }), 400
            
            return jsonify({
                'text': result['text'],
                'sentiment': result['sentiment'],
                'confidence': result['confidence']
            }), 200
        
        elif 'texts' in data:
            texts = data['texts']
            
            if not isinstance(texts, list):
                return jsonify({
                    'error': 'Texts field must be an array'
                }), 400
            
            if len(texts) == 0:
                return jsonify({
                    'error': 'Texts array cannot be empty'
                }), 400
            
            results = []
            for text in texts:
                result = predict_single_sentiment(text)
                results.append(result)
            
            return jsonify({
                'results': results,
                'total': len(results)
            }), 200
        
        else:
            return jsonify({
                'error': 'Missing text or texts field in request body'
            }), 400
        
    except Exception as e:
        return jsonify({
            'error': f'Server error: {str(e)}'
        }), 500

@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({
        'status': 'healthy',
        'model_loaded': model is not None
    }), 200

if __name__ == '__main__':
    load_model()
    app.run(host='0.0.0.0', port=5000, debug=True)