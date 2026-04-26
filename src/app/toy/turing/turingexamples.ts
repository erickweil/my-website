const exampleCodes: Record<string, string> = {
"busy beaver": `
A _ 1 R B
A 0 1 R B
A 1 1 L C

B _ 1 R C
B 0 1 R C
B 1 1 R B

C _ 1 R D
C 0 1 R D
C 1 0 L E

D _ 1 L A
D 0 1 L A
D 1 1 L D

E _ 1 R HALT
E 0 1 R HALT
E 1 0 L A
`,
"counter": `
inicio * 0 > C

C _  1  > D
C 0  1  > D
C 1  0  < C

D 0  0  > D
D _  _  < C
`,
"xor": `
input[0,0] 1010111100011011
input[0,1] 1100101111001110
input[0,2] 1111111111111111

A 0 0 D B
A 1 1 D C

B 0 0 D D
B 1 1 D E

C 0 0 D E
C 1 1 D D

D 0 0 R F
D 1 0 R F

E 0 1 R F
E 1 1 R F

F 0 0 U HALT
F 1 1 U G

G 0 0 U A
G 1 1 U A
`,
"fast-adder":`
default 0
input[-22,1] 00001110001101111000011 
input[-22,2] 01110000001010111110000 
input[-22,3]  11111111111111111111111 
    
A 0   0 D B
A 1   1 D C
                          
B 0   0 D D
B 1   1 D E
     
C 0   0 D E
C 1   1 D F
           

D 0   0 D G
D 1   1 D H    
E 0   0 D H
E 1   1 D I     
F 0   0 D I
F 1   1 D J
                     
G 0   0 L HALT
G 1   0 L K      
H 0   1 L HALT
H 1   1 L K      
I 0   0 L HALT
I 1   0 L O       
J 0   1 L HALT
J 1   1 L O
                        
// no carry                
K 0   0 L HALT
K 1   1 U L       
L 0   0 U M
L 1   1 U M        
M 0   0 U N
M 1   1 U N         
N 0   0 N A
N 1   0 N A
                        
// carry                 
O 0   0 L HALT
O 1   1 U P              
P 0   0 U Q
P 1   1 U Q        
Q 0   0 U R
Q 1   1 U R         
R 0   1 N A
R 1   1 N A
`,
"fill": `
inicio _   1 = A

A  1   * R A1
A  _   * R A3
A1 _   1 L A2
A2 1   * D A
A3 _   * U B

B  1   * D B1
B  _   * D B3
B1 _   1 U B2
B2 1   * L B
B3 _   * R C

C  1   * L C1
C  _   * L C3
C1 _   1 R C2
C2 1   * U C
C3 _   * D D

D  1   * U D1
D  _   * U D3
D1 _   1 D D2
D2 1   * R D
D3 _   * L A
`,
};

export function getExampleCodes(): Record<string, string> {
    return exampleCodes;
}