import os

def main():
    keywords = ["оплат", "платеж", "график", "транзак", "поступлен"]
    encodings = ["utf-8", "cp1251", "utf-16", "utf-16-le", "utf-16-be", "cp866"]
    
    with open("scratch/search_results.txt", "w", encoding="utf-8") as out:
        for f in os.listdir('.'):
            if f.endswith('.txt') and f != "search_results.txt":
                for enc in encodings:
                    try:
                        with open(f, 'r', encoding=enc, errors='ignore') as file:
                            content = file.read()
                        # If we find cyrillic letters, it means the encoding works!
                        # Russian Cyrillic characters are in the range \u0400-\u04FF
                        has_cyrillic = any('\u0400' <= char <= '\u04FF' for char in content[:1000])
                        if has_cyrillic:
                            out.write(f"\n=== FILE: {f} ENCODING: {enc} ===\n")
                            lines = content.split('\n')
                            for idx, line in enumerate(lines):
                                for kw in keywords:
                                    if kw in line.lower():
                                        out.write(f"Line {idx+1}: {line.strip()[:150]}\n")
                                        break
                            break # Found correct encoding for this file
                    except Exception as e:
                        pass

if __name__ == "__main__":
    main()
