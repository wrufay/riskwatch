import re
import pandas as pd

pattern = re.compile(r'\[(\d{2}/\d{2}/\d{2} \d{2}:\d{2})\] (.+?): (.+)')

rows = []
with open('messages_clean.txt', 'r', encoding='utf-8') as f:
    for line in f:
        match = pattern.match(line.strip())
        if match:
            timestamp, author, text = match.groups()
            rows.append({'timestamp': timestamp, 'author': author, 'text': text})

df = pd.DataFrame(rows)

# filter system messages
system_phrases = ['Updated room membership', 'Space Updated']
df = df[~df['text'].isin(system_phrases)]

print(df.shape)
print(df['author'].value_counts())