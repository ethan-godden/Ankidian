---
tags: [flashcards/code/python]
---
# Python

## Recursion

Complete the Fibonacci function:
```python
def fib(n):
    if n < 2:
        return {{c1::n}}
    return {{c2::fib(n - 1) + fib(n - 2)}}
```

## Loops

Sum the even numbers, writing the whole loop body:
```python
def sum_even(xs):
    total = 0
    for x in xs:
        {{c1::if x % 2 == 0:
            total += x}}
    return total
```

## Strings

Use an f-string:
```python
name = "Ada"
print({{c1::f"Hello, {name}!"}})
```
