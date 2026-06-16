import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'test_models'))

from test_slm import extract_candidates


# --- JSON array (primary strategy) ---

def test_json_array_bare():
    text = '["apple", "pear", "fruit", "food", "plant"]'
    result = extract_candidates(text)
    assert result == ["apple", "pear", "fruit", "food", "plant"], result


def test_json_array_embedded_in_prose():
    text = 'Here are my guesses: ["apple", "pear", "fruit", "food", "plant"]\nHope that helps!'
    result = extract_candidates(text)
    assert result == ["apple", "pear", "fruit", "food", "plant"], result


def test_json_array_caps_at_n():
    text = '["apple", "pear", "fruit", "food", "plant", "extra"]'
    result = extract_candidates(text)
    assert len(result) == 5, result


def test_json_array_fewer_than_n():
    text = '["apple", "pear"]'
    result = extract_candidates(text)
    assert result == ["apple", "pear"], result


def test_json_array_preferred_over_numbered_list():
    text = '["apple", "pear", "fruit", "food", "plant"]\n1. something\n2. else'
    result = extract_candidates(text)
    assert result == ["apple", "pear", "fruit", "food", "plant"], result


# --- Numbered list (fallback strategy) ---

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


# --- First lines (final fallback) ---

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
