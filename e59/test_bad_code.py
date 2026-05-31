class VeryLargeClass:
    def __init__(self):
        self.attr1 = 1
        self.attr2 = 2
        self.attr3 = 3
        self.attr4 = 4
        self.attr5 = 5
        self.attr6 = 6
        self.attr7 = 7
        self.attr8 = 8
        self.attr9 = 9
        self.attr10 = 10
        self.attr11 = 11
        self.attr12 = 12
        self.attr13 = 13
        self.attr14 = 14
        self.attr15 = 15
        self.attr16 = 16

    def method1(self): pass
    def method2(self): pass
    def method3(self): pass
    def method4(self): pass
    def method5(self): pass
    def method6(self): pass
    def method7(self): pass
    def method8(self): pass
    def method9(self): pass
    def method10(self): pass
    def method11(self): pass
    def method12(self): pass
    def method13(self): pass
    def method14(self): pass
    def method15(self): pass
    def method16(self): pass
    def method17(self): pass
    def method18(self): pass
    def method19(self): pass
    def method20(self): pass
    def method21(self): pass


def very_long_function(a, b, c, d, e, f, g):
    x = 1
    x = 1
    x = 1
    x = 1
    x = 1
    x = 1
    x = 1
    x = 1
    x = 1
    x = 1
    x = 1
    x = 1
    x = 1
    x = 1
    x = 1
    x = 1
    x = 1
    x = 1
    x = 1
    x = 1
    x = 1
    x = 1
    x = 1
    x = 1
    x = 1
    x = 1
    x = 1
    x = 1
    x = 1
    x = 1
    x = 1
    x = 1
    x = 1
    x = 1
    x = 1
    x = 1
    x = 1
    x = 1
    x = 1
    x = 1
    x = 1
    x = 1
    x = 1
    x = 1
    x = 1
    x = 1
    x = 1
    x = 1
    x = 1
    x = 1
    x = 1
    x = 1
    x = 1
    x = 1
    x = 1
    x = 1
    return x


def deep_nesting_example(data):
    result = []
    for item in data:
        if item > 0:
            for subitem in item:
                if subitem < 100:
                    try:
                        for i in range(subitem):
                            if i % 2 == 0:
                                result.append(i)
                    except:
                        pass
    return result


def duplicate_func1(x, y):
    result = []
    for i in range(x):
        for j in range(y):
            if i + j > 10:
                result.append(i * j)
            else:
                result.append(i + j)
    return sum(result)


def duplicate_func2(a, b):
    result = []
    for i in range(a):
        for j in range(b):
            if i + j > 10:
                result.append(i * j)
            else:
                result.append(i + j)
    return sum(result)
