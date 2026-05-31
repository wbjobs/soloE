def process_user_data(users, config, options):
    result = []
    
    for user in users:
        if user.get('active'):
            if config.get('validate'):
                if options.get('strict'):
                    for key in ['name', 'email', 'age']:
                        if key not in user:
                            raise ValueError(f"Missing key: {key}")
            
            processed = {}
            processed['id'] = user.get('id')
            processed['name'] = user.get('name', '').upper()
            processed['email'] = user.get('email', '').lower()
            
            if user.get('age'):
                age = int(user['age'])
                if age >= 18:
                    processed['is_adult'] = True
                else:
                    processed['is_adult'] = False
            
            if config.get('include_address'):
                address = user.get('address', {})
                processed['city'] = address.get('city', '')
                processed['country'] = address.get('country', '')
            
            result.append(processed)
    
    return result


def calculate_statistics(data, weights, thresholds):
    total = 0
    count = 0
    max_val = float('-inf')
    min_val = float('inf')
    
    for item in data:
        value = item.get('value', 0)
        
        if weights:
            for weight in weights:
                if weight['type'] == 'multiplier':
                    value *= weight['factor']
                elif weight['type'] == 'offset':
                    value += weight['offset']
        
        if thresholds:
            for threshold in thresholds:
                if threshold['type'] == 'max':
                    value = min(value, threshold['value'])
                elif threshold['type'] == 'min':
                    value = max(value, threshold['value'])
        
        total += value
        count += 1
        
        if value > max_val:
            max_val = value
        if value < min_val:
            min_val = value
    
    stats = {
        'total': total,
        'count': count,
        'average': total / count if count > 0 else 0,
        'max': max_val,
        'min': min_val
    }
    
    return stats
