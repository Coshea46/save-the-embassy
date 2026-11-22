"""Rebuild the original integer-pixel PNGs with Pillow from the compiled shared map.

From .embassy/: npm run build && python apps/game/art/draw.py
Artwork is checked in. Playing the game requires no image libraries.
"""
import json
import random
import subprocess
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "apps/game/public"
tiles = json.loads(subprocess.check_output(
    ["node", "--input-type=module", "-e", "import {tiles} from '@embassy/simulation';console.log(JSON.stringify(tiles))"],
    cwd=ROOT, text=True))
T, MX, MY = 24, 32, 25
rng = random.Random(168)
w, h = T*len(tiles[0])+2*MX, T*len(tiles)+2*MY
img = Image.new("RGB", (w,h), "#829e99")
d = ImageDraw.Draw(img)
ink = "#243b3b"
def rect(x,y,w,h,col):
    if w>0 and h>0: d.rectangle((x,y,x+w-1,y+h-1), fill=col)
def box(x,y,w,h,fill,edge=ink):
    rect(x,y,w,h,edge);rect(x+1,y+1,w-2,h-2,fill)
def line(points, col): d.line(points, fill=col)
def poly(points,col): d.polygon(points, fill=col)
def tree(x,y,size):
    # Three stepped layers, each with a snowy windward edge.
    rect(x-2,y-9,4,10,"#495952")
    for n in range(3):
        s=size-n*3; by=y-4-n*5
        for k in range(s):
            span=(k//2)*2
            rect(x-span,by-s+k,span*2+1,1,"#355951" if n!=1 else "#496e61")
            rect(x-span,by-s+k,span+1,1,"#719382")
            if k<s*0.62: rect(x-span,by-s+k,max(1,span//2+1),1,"#d0dfcc")
def window(x,y):
    box(x,y,25,11,"#718d88"); rect(x+2,y+2,21,6,"#9bbdc0")
    rect(x+3,y+2,8,1,"#deece2");rect(x+12,y+1,2,8,ink);rect(x-1,y+10,27,2,"#525f59")
def plant(x,y):
    rect(x-4,y,8,4,"#a56b45");rect(x-3,y+4,6,2,"#745643")
    rect(x-1,y-8,2,8,"#4a7051")
    for dx,dy in [(-4,-5),(2,-6),(-2,-9),(3,-3)]:
        rect(x+dx,y+dy,4,3,"#467b57");rect(x+dx,y+dy,2,1,"#95ae72")
def desk(x,y):
    box(x+1,y+9,23,11,"#975f43");rect(x+3,y+13,19,3,"#ab7551")
    box(x-1,y+6,26,8,"#c18c5b");rect(x,y+7,24,1,"#e0ad75")
    box(x+10,y+1,11,8,"#5d888c");rect(x+12,y+2,6,2,"#a9cbbe");rect(x+14,y+9,4,2,ink)
    rect(x+2,y+8,5,3,"#f6e4ba");rect(x+3,y+9,3,1,"#9a9782")
def rack(x,y):
    box(x+1,y-2,15,23,"#485a5a")
    for j in range(4):
        box(x+3,y+j*5,11,4,"#728989")
        rect(x+4,y+1+j*5,5,1,"#344648");rect(x+11,y+1+j*5,1,1,"#ade5ae")
    box(x+16,y+4,7,16,"#ae7950");rect(x+18,y+7,3,6,"#dfb26b")
def stove(x,y):
    box(x,y+1,24,19,"#b0b1a1");box(x-1,y,25,8,"#d8d5b8")
    for i in [2,12]: box(x+i,y+2,7,4,"#7f7e70")
    box(x+3,y+10,16,7,"#455756");rect(x+6,y+11,9,1,"#93aca2")
    rect(x+17,y-4,6,5,"#bb7151");rect(x+18,y-5,4,1,ink)
def shelves(x,y):
    box(x-1,y-1,26,22,"#98714e")
    colors=["#a95e46","#66847a","#c39f63","#677f95","#e3c598"]
    for j in [0,9]:
        for i in range(6):
            dy=rng.randrange(3); c=colors[(i+j)%5]
            rect(x+1+i*4,y+j+1+dy,3,7-dy,c);rect(x+2+i*4,y+j+5,2,1,"#d6c99f")
        rect(x,y+j+8,24,2,"#604d3e")
def bench(x,y):
    box(x-1,y+1,26,17,"#965e3f")
    for i in [2,6,10]:rect(x,y+i,24,3,"#d7a56a");rect(x+1,y+i,22,1,"#e7bb83")
    box(x+14,y-2,8,7,"#a17343");rect(x+15,y,6,1,"#e0b677")
    rect(x+17,y-4,2,4,"#795438")
def badge(x,y):
    box(x,y,19,12,"#c8c6a2");rect(x+2,y+2,15,8,"#f5e5bd")
    rect(x+6,y+2,3,8,"#4e7780");rect(x+2,y+5,15,2,"#4e7780")
# Snowbound courtyard with scattered wind-packed banks, shrubs and walkway lights.
for i in range(290):
    x,y=rng.randrange(w),rng.randrange(h)
    rect(x,y,rng.randrange(2,15),1,rng.choice(["#9ab3a6","#afc2b1","#6f938a"]))
for x in range(-6,w+12,17):
    tree(x+rng.randrange(8),rng.randrange(14,28),rng.randrange(9,16))
for x in [7,19,w-13,w-3]:
    for y in range(46,h,39): tree(x,y+rng.randrange(8),rng.randrange(9,15))
for x in range(15,w,29):
    if abs(x-w//2)>45:tree(x,h-rng.randrange(-3,8),rng.randrange(10,16))
rect(MX+4,MY+5,T*19+2,T*11+2,"#597469")
rooms=["reception","office","kitchen","plant","archive","sauna"]
palette=[("#c7ad81","#ba9d72"),("#b69470","#a78a68"),("#c0c5a8","#adb49d"),
         ("#8a9d93","#829389"),("#bc966d","#b08a63"),("#d0a16b","#c18f60")]
for gy,row in enumerate(tiles):
    for gx,ch in enumerate(row):
        x,y=MX+gx*T,MY+gy*T
        room=min(2,max(0,(gx-1)//6))+(3 if gy>5 else 0)
        if ch=="#":
            rect(x,y,T,T,ink);rect(x+1,y+1,T-1,8,"#71887b")
            rect(x+1,y+2,T-1,2,"#94a58d");rect(x+1,y+8,T-1,2,"#465e59")
            rect(x+1,y+11,T-1,11,"#61746a")
            rect(x+2,y+12,9,1,"#748679");rect(x+6,y+16,15,1,"#54665e")
            if gy in (0,10):rect(x,y,T,3,"#bdc9b5")
        elif ch in "=+":
            rect(x,y,T,T,"#a09e86");rect(x,y+2,T,20,"#b8af91")
            if ch=="=":
                rect(x,y+4,T,16,"#527b73");rect(x,y+5,T,1,"#9baf90");rect(x,y+18,T,1,"#94a88a")
                for j in range(0,T,8): rect(x+j,y+10,2,2,"#668b7c")
            else:
                rect(x,y,3,T,"#98734e");rect(x+T-3,y,3,T,"#765a42");rect(x+4,y+3,T-8,2,"#d2bb8d")
        else:
            c1,c2=palette[room];rect(x,y,T,T,c1)
            if room in (2,3):
                for a in (0,12):
                    for b in (0,12):rect(x+a,y+b,11,11,c2 if (gx+gy+a//12+b//12)%2 else c1)
                rect(x,y+T-1,T,1,c2);rect(x+T-1,y,1,T,c2)
            else:
                for i in (0,8,16):
                    rect(x,y+i,T,1,c2);rect(x+(gy*7+i+gx*3)%T,y+i,1,8,c2)
                    rect(x+(gx*2+i)%17,y+i+4,4,1,c2)
            if gy in [1,7]:rect(x,y,T,2,"#786e57")
            if gx in [1,7,13]:rect(x,y,2,T,"#81765e")
# Wall fittings occupy masonry, leaving traversable squares open.
for col in range(3):
    x=MX+(col*6+1)*T
    for row in [0,6]:
        y=MY+row*T
        window(x+3,y+9);window(x+85,y+9)
        if row==0: badge(x+49,y+8)
        else:
            box(x+38,y+10,9,8,"#c6ad7c");rect(x+40,y+12,5,2,"#8a785a")
    plant(x+114,MY+20)
# Central fixtures are silhouettes on the six impassable F tiles.
for i,room in enumerate(rooms):
    x=MX+(3+(i%3)*6)*T;y=MY+(2+6*(i//3))*T
    rect(x+1,y+17,25,5,"#998768")
    [desk,desk,stove,rack,shelves,bench][i](x,y)
    if i==0:
        rect(x-1,y+2,1,9,ink);rect(x,y+2,6,4,"#e5e5c6");rect(x+2,y+2,1,4,"#4d8188")
    if i==1:plant(x-1,y+6)
# Sauna panelling and copper pipes, archive card drawers, recessed kitchen cupboards.
for i in range(5):
    x=MX+13*T+i*23;y=MY+6*T+12
    rect(x,y,17,8,"#ad8159");rect(x+1,y+1,15,1,"#c89a69");rect(x+3,y+3,1,4,"#906948")
for i in range(3):
    x=MX+13*T+i*37;y=MY+16
    box(x,y,28,7,"#99a68e");rect(x+13,y+1,1,5,"#6d8174");rect(x+10,y+4,2,1,ink)
for i in range(3):
    x=MX+7*T+i*32;y=MY+6*T+14
    box(x,y,22,7,"#b28b61");rect(x+8,y+2,6,2,"#dcc59a")
for x in range(MX+25,MX+120,12):
    rect(x,MY+6*T+17,12,3,"#a97952");rect(x,MY+6*T+17,2,4,"#d0a071")
# Recessed counter runs sit against solid walls. Rugs and grilles are flush with the floors.
for k in range(3):
    for row in [1,7]:
        x=MX+(1+6*k)*T; y=MY+row*T
        rect(x,y,119,3,"#655f5080" if img.mode=="RGBA" else "#92836a")
        for a in [2,112]:
            rect(x+a,y,5,2,"#c2a679")
def rug(x,y,w,h,edge,mid,trim):
    rect(x,y,w,h,edge);rect(x+2,y+2,w-4,h-4,mid)
    for i in range(3,w-4,5):
        rect(x+i,y+2,2,1,trim);rect(x+i,y+h-3,2,1,trim)
    for j in range(4,h-3,5):
        rect(x+3,y+j,1,2,trim);rect(x+w-4,y+j,1,2,trim)
x,y=MX+T,MY+T
rug(x+5,y+9,28,39,"#8b604e","#ae8064","#e0b58e")
for a in [0,1]:
    yy=y+8+a*18
    box(x-10,yy,12,15,"#a16e4c");box(x-8,yy+2,8,9,"#688675")
    rect(x-9,yy+12,10,2,"#76543d")
# Reception noticeboard and a brass clock along the rear wall.
box(x+36,y-18,20,13,"#9d714c");rect(x+38,y-16,7,6,"#ecdcad");rect(x+46,y-14,5,6,"#c5d2b5")
box(x+91,y-19,9,9,"#e9d7ab");line([(x+95,y-18),(x+95,y-15),(x+98,y-14)],ink)
# Office has a framed chart and a built-in bookcase; its broad carpet sits below the desk.
x=MX+7*T
rug(x+31,y+14,55,40,"#737e68","#8d9981","#bab897")
desk(x+48,y+24);plant(x+47,y+30)
shelves(x+3,y-22)
box(x+76,y-20,20,13,"#cbbf91")
for a,v in enumerate([2,5,4,7,8]):
    rect(x+78+a*3,y-9-v,2,v,"#638873")
# Tiled splashback, cupboards and inset sink.
x=MX+13*T
for a in range(0,118,8):
    rect(x+a,y-12,7,4,"#a0b2a0");rect(x+a+2,y-7,7,3,"#c8cbb0")
box(x+8,y-5,102,8,"#cabda1")
box(x+15,y-4,16,5,"#799396");rect(x+18,y-3,10,2,"#b1c6bc")
rect(x+23,y-8,2,5,ink);rect(x+19,y-8,5,1,ink)
for a in [51,56,62]:
    box(x+a,y-9,5,5,"#ad6b4c");rect(x+a,y-10,5,2,"#76513f")
plant(x+97,y-3)
# Lower-wall cutaways expose archive bays and the sauna's cedar tiers.
x,y=MX+T,MY+10*T
for a in [5,24,43]:
    box(x+a,y+2,14,16,"#364e4b")
    for v in [4,8,12]:
        rect(x+a+2,y+v,9,2,"#728a7c");rect(x+a+10,y+v,1,1,"#c7d08b")
for a in [78,88,98]:
    rect(x+a,y+1,4,16,"#97714e");rect(x+a,y+1,1,16,"#d7ae78")
for a in [7,95]:
    for j in range(3): rect(x+a,MY+8*T+10+j*3,11,1,"#657c74")
x=MX+7*T
for a in [2,32,62,92]:shelves(x+a,y+2)
x=MX+13*T
for a in range(3):
    box(x-1,y+a*6,122,6,"#b28259");rect(x+1,y+a*6+1,118,1,"#deb17c")
box(x+8,y-3,12,7,"#b4a084");rect(x+10,y-2,8,2,"#dbd6af")
for a in [4,10,16]:rect(x+100+a,MY+8*T+6,1,18,"#ab8158")
# Snow caps, wall lights and hand-painted corridor borders.
for a in [2,6,12,16]:
    x=MX+a*T+9;y=MY+5*T
    box(x,y-5,6,8,"#a58a57");rect(x+1,y-4,4,4,"#ffe0a1")
for a in range(2,17,2):
    x=MX+a*T+8;y=MY+5*T+11
    line([(x-2,y),(x,y-2),(x+2,y),(x,y+2),(x-2,y)],"#9ba684")
# Room names are tiny original bitmap lettering, optically centred on the floor.
glyphs={
'A':["010","101","111","101","101"],'B':["110","101","110","101","110"],'C':["011","100","100","100","011"],'D':["110","101","101","101","110"],'E':["111","100","110","100","111"],'F':["111","100","110","100","100"],'G':["011","100","101","101","011"],'H':["101","101","111","101","101"],'I':["111","010","010","010","111"],'J':["001","001","001","101","010"],'K':["101","101","110","101","101"],'L':["100","100","100","100","111"],'M':["101","111","111","101","101"],'N':["101","111","111","111","101"],'O':["010","101","101","101","010"],'P':["110","101","110","100","100"],'Q':["010","101","101","011","001"],'R':["110","101","110","101","101"],'S':["011","100","010","001","110"],'T':["111","010","010","010","010"],'U':["101","101","101","101","111"],'V':["101","101","101","101","010"],'W':["101","101","111","111","101"],'Y':["101","101","010","010","010"],' ':["000"]*5}
for i,name in enumerate(["RECEPTION","OFFICES","KITCHEN","SERVER PLANT","ARCHIVES","SAUNA"]):
    x=MX+(3+6*(i%3))*T+12-len(name)*2;y=MY+(3+(i//3)*6)*T+12
    box(x-4,y-3,len(name)*4+7,11,"#485c50","#61705c")
    for k,char in enumerate(name):
        for j,row in enumerate(glyphs[char]):
            for a,v in enumerate(row):
                if v=="1":rect(x+4*k+a,y+j,1,1,"#f0dfaf")
img.save(OUT/"floor.png")
# Ranger sheet: south/west/north/east rows; idle, two strides, work, and completion.
img=Image.new("RGBA",(5*20,4*24));d=ImageDraw.Draw(img)
for direction in range(4):
    for phase in range(5):
        x=phase*20;y=direction*24+(phase==2)
        rect(x+4,y+20,12,2,"#3e504ba0")
        for k in [0,1]:
            foot=y+18+(phase==k+1)
            rect(x+6+k*5,foot,4,3,ink);rect(x+6+k*5,foot-2,3,3,"#4d5860")
        box(x+5,y+10,11,8,"#456c6d");rect(x+7,y+11,2,5,"#78948a")
        rect(x+5,y+16,10,1,"#253f43");rect(x+10,y+16,2,1,"#d2af66")
        if direction!=2:
            box(x+6,y+5,9,7,"#deb28b");rect(x+6,y+9,8,2,"#bc896b")
            for eye in ([8,12] if direction==0 else [7] if direction==1 else [13]):
                rect(x+eye,y+7,1,1,ink)
            rect(x+8,y+11,5,2,"#d88557")
        else:box(x+6,y+5,9,7,"#77614e")
        box(x+6,y+2,9,5,"#496d69");rect(x+5,y+5,11,2,ink);rect(x+8,y+3,3,1,"#9bb39a")
        arm=y+(8 if phase in (3,4) else 12)
        rect(x+3,arm,3,5,"#3a5958");rect(x+3,arm+4,3,2,"#dfb38c")
        rect(x+15,arm+1,2,5,"#68867a");rect(x+15,arm+5,2,2,"#dfa581")
        if phase==3:box(x+1,y+10,4,5,"#e9dfbe")
        if phase==4:
            rect(x+15,y+2,3,1,"#f8d86c");rect(x+16,y+1,1,3,"#f8d86c")
img.save(OUT/"ranger.png")
img=Image.new("RGBA",(12,14));d=ImageDraw.Draw(img)
poly([(1,0),(7,0),(11,4),(11,13),(0,13),(0,1)],"#182a2b")
poly([(2,1),(6,1),(10,5),(10,12),(1,12),(1,2)],"#fff1cc")
rect(6,1,1,4,"#526260");rect(6,4,4,1,"#526260")
for y,wid in [(6,7),(8,7),(10,5)]:rect(2,y,wid,1,"#405151")
img.save(OUT/"paper.png")
img=Image.new("RGBA",(30,30));d=ImageDraw.Draw(img)
poly([(2,2),(27,2),(27,18),(24,23),(15,28),(5,23),(2,17)],"#f2e8c8")
poly([(5,5),(24,5),(24,17),(21,21),(15,25),(8,21),(5,17)],"#446c62")
rect(8,8,14,3,"#f0d49a");rect(10,11,2,7,"#f0d49a");rect(14,11,2,7,"#f0d49a");rect(18,11,2,7,"#f0d49a");rect(8,19,14,2,"#f0d49a")
img.save(OUT/"crest.png")
