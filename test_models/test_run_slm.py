import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from run_slm import extract_candidates

def test_numbered_list():
    text = "1. apple\n2. pear\n3. fruit\n4. food\n5. plant"
    result = extract_candidates(text)
    assert result == ["apple", "pear", "fruit", "food", "plant"], result

def test_numbered_list_with_parens():
    text = "1) apple\n2) pear\n3) fruit\n4) food\n5) plant"
    result = extract_candidates(text)
    assert result == ["apple", "pear", "fruit", "food", "plant"], result

def test_numbered_list_caps_at_n():
    text = "1. apple\n2. pear\n3. fruit\n4. food\n5. plant\n6. extra"
    result = extract_candidates(text)
    assert len(result) == 5, result

def test_fallback_first_lines():
    text = "apple\npear\nfruit\nfood\nplant"
    result = extract_candidates(text)
    assert result == ["apple", "pear", "fruit", "food", "plant"], result

def test_fallback_skips_empty_lines():
    text = "apple\n\npear\n\nfruit\n\nfood\n\nplant"
    result = extract_candidates(text)
    assert result == ["apple", "pear", "fruit", "food", "plant"], result

def test_numbered_list_preferred_over_fallback():
    text = "Here are my guesses:\n1. apple\n2. pear\n3. fruit\n4. food\n5. plant\nHope that helps!"
    result = extract_candidates(text)
    assert result == ["apple", "pear", "fruit", "food", "plant"], result

def test_returns_fewer_than_n_if_model_gave_less():
    text = "1. apple\n2. pear"
    result = extract_candidates(text)
    assert result == ["apple", "pear"], result

if __name__ == "__main__":
    tests = [v for k, v in list(globals().items()) if k.startswith("test_")]
    passed = failed = 0
    for t in tests:
        try:
            t()
            print(f"  PASS  {t.__name__}")
            passed += 1
        except Exception as e:
            print(f"  FAIL  {t.__name__}: {e}")
            failed += 1
    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)
