from vpython import *

G = 6.674e-11

scene.title = "太阳系引力模拟 - 探测器发射器"
scene.width = 1400
scene.height = 800
scene.background = color.black
scene.camera.pos = vector(0, 2e11, 3e11)

sun = sphere(pos=vector(0, 0, 0), radius=7e9, color=color.yellow, mass=1.989e30, make_trail=False)
sun.velocity = vector(0, 0, 0)

earth = sphere(pos=vector(1.496e11, 0, 0), radius=3e9, color=color.blue, mass=5.972e24, make_trail=True, trail_color=color.blue, retain=1000)
earth.velocity = vector(0, 0, 29783)

mars = sphere(pos=vector(2.279e11, 0, 0), radius=2e9, color=color.red, mass=6.39e23, make_trail=True, trail_color=color.red, retain=1000)
mars.velocity = vector(0, 0, 24100)

planets = [sun, earth, mars]
probes = []

dt = 3600

launcher_pos = vector(1.8e11, 0, 0)
launcher = cone(pos=launcher_pos, axis=vector(0, 1e10, 0), radius=5e9, color=color.green)
launcher_arrow = arrow(pos=launcher_pos, axis=vector(0, 2e10, 0), color=color.white, shaftwidth=2e9)

scene.append_to_caption('\n')
scene.append_to_caption('=== 探测器发射器控制面板 ===\n\n')

scene.append_to_caption('发射速度 (km/s): ')
speed_slider = slider(min=5, max=60, value=30, length=200, bind=lambda s: update_launcher())
scene.append_to_caption('  ')
speed_label = wtext(text=f'{speed_slider.value:.1f}')
scene.append_to_caption('\n\n')

scene.append_to_caption('发射角度 (度): ')
angle_slider = slider(min=0, max=360, value=90, length=200, bind=lambda s: update_launcher())
scene.append_to_caption('  ')
angle_label = wtext(text=f'{angle_slider.value:.0f}')
scene.append_to_caption('\n\n')

scene.append_to_caption('探测器质量 (kg): ')
mass_slider = slider(min=100, max=10000, value=1000, length=200)
scene.append_to_caption('  ')
mass_label = wtext(text=f'{mass_slider.value:.0f}')
scene.append_to_caption('\n\n')

button(text='发射探测器', bind=lambda b: launch_probe())
scene.append_to_caption('  ')
button(text='清除所有探测器', bind=lambda b: clear_probes())
scene.append_to_caption('\n\n')
status_label = wtext(text='状态: 就绪 - 拖动绿色发射器改变发射位置\n')

dragging = False

def update_launcher():
    speed = speed_slider.value * 1000
    angle = angle_slider.value * pi / 180
    launcher.axis = vector(speed * cos(angle) * 500, speed * sin(angle) * 500, 0)
    launcher_arrow.axis = launcher.axis
    speed_label.text = f'{speed_slider.value:.1f}'
    angle_label.text = f'{angle_slider.value:.0f}'

def calculate_acceleration(body, all_bodies):
    total_force = vector(0, 0, 0)
    for other_body in all_bodies:
        if other_body != body:
            r = other_body.pos - body.pos
            distance = mag(r)
            if distance == 0:
                continue
            force_magnitude = G * other_body.mass * body.mass / (distance ** 2)
            force_direction = norm(r)
            total_force += force_magnitude * force_direction
    return total_force / body.mass

def launch_probe():
    speed = speed_slider.value * 1000
    angle = angle_slider.value * pi / 180
    mass = mass_slider.value
    
    probe = sphere(pos=launcher.pos + norm(launcher.axis) * 1e10, 
                    radius=2e9, 
                    color=color.magenta, 
                    mass=mass,
                    make_trail=True, 
                    trail_color=color.magenta, 
                    retain=2000)
    
    probe.velocity = vector(speed * cos(angle), speed * sin(angle), 0)
    probe.acceleration = calculate_acceleration(probe, planets + probes)
    probe.velocity += probe.acceleration * dt / 2
    
    probes.append(probe)
    status_label.text = f'状态: 已发射探测器 #{len(probes)} - 速度: {speed/1000:.1f} km/s\n'

def clear_probes():
    for probe in probes:
        probe.visible = False
    probes.clear()
    status_label.text = '状态: 已清除所有探测器\n'

def handle_mousedown(event):
    global dragging
    if event.pick == launcher:
        dragging = True

def handle_mouseup(event):
    global dragging
    dragging = False

def handle_mousemove(event):
    if dragging:
        new_pos = scene.mouse.pos
        new_pos.z = 0
        launcher.pos = new_pos
        launcher_arrow.pos = new_pos
        update_launcher()

scene.bind('mousedown', handle_mousedown)
scene.bind('mouseup', handle_mouseup)
scene.bind('mousemove', handle_mousemove)

for planet in planets:
    if planet != sun:
        planet.acceleration = calculate_acceleration(planet, planets)
        planet.velocity += planet.acceleration * dt / 2

update_launcher()

while True:
    rate(100)
    
    for planet in planets:
        if planet != sun:
            planet.pos += planet.velocity * dt
    
    for probe in probes:
        probe.pos += probe.velocity * dt
    
    for planet in planets:
        if planet != sun:
            new_acceleration = calculate_acceleration(planet, planets)
            planet.velocity += new_acceleration * dt
            planet.acceleration = new_acceleration
    
    all_bodies = planets + probes
    for probe in probes:
        new_acceleration = calculate_acceleration(probe, all_bodies)
        probe.velocity += new_acceleration * dt
        probe.acceleration = new_acceleration
