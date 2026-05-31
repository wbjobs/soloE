import joblib
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.naive_bayes import MultinomialNB
from sklearn.pipeline import Pipeline
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score
import os


def load_sample_data():
    positive_reviews = [
        "This movie is fantastic! I loved every moment of it.",
        "Great acting and a wonderful story. Highly recommend!",
        "The best film I've seen this year. Amazing direction.",
        "I absolutely enjoyed this movie. Perfect for a night out.",
        "Brilliant performance by the lead actor. A must watch!",
        "Beautiful cinematography and engaging plot. Loved it!",
        "A masterpiece of modern cinema. 10 out of 10!",
        "Very entertaining and well made. I would watch again.",
        "Excellent movie with great characters and story.",
        "Superb direction and acting. Five stars!",
        "good",
        "great",
        "excellent",
        "amazing",
        "wonderful",
        "love this movie",
        "this is good",
        "so good",
        "really good",
        "very good"
    ]
    
    negative_reviews = [
        "This movie was terrible. I wasted two hours of my life.",
        "Poor acting and a boring plot. Don't waste your time.",
        "The worst film I've ever seen. Avoid at all costs.",
        "I hated this movie. It was so disappointing.",
        "Awful direction and bad writing. Complete disaster.",
        "Not worth watching. Very boring and predictable.",
        "Terrible execution of a promising concept. I left early.",
        "Disappointing from start to finish. Would not recommend.",
        "Bad movie with no redeeming qualities. One star.",
        "Horrible script and bad acting. Total waste of money.",
        "bad",
        "terrible",
        "awful",
        "horrible",
        "worst",
        "hate this movie",
        "this is bad",
        "so bad",
        "really bad",
        "very bad"
    ]
    
    texts = positive_reviews + negative_reviews
    labels = ["positive"] * 20 + ["negative"] * 20
    
    return texts, labels


def train_model():
    print("Loading training data...")
    texts, labels = load_sample_data()
    
    X_train, X_test, y_train, y_test = train_test_split(
        texts, labels, test_size=0.1, random_state=42
    )
    
    print("Training sentiment classifier...")
    model = Pipeline([
        ('tfidf', TfidfVectorizer(max_features=1000, stop_words='english', min_df=1)),
        ('classifier', MultinomialNB())
    ])
    
    model.fit(X_train, y_train)
    
    y_pred = model.predict(X_test)
    accuracy = accuracy_score(y_test, y_pred)
    print(f"Model accuracy: {accuracy:.2f}")
    
    print("Saving model...")
    joblib.dump(model, 'sentiment_model.pkl')
    print("Model saved as sentiment_model.pkl")
    
    return model


if __name__ == "__main__":
    train_model()