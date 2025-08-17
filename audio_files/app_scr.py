"""import pandas as pd
import os
import subprocess
import gradio as gr

# Load the Excel file once
FILE_NAME = "Train Details.xlsx"

def get_train_details(train_no):
    try:
        df = pd.read_excel(FILE_NAME, dtype={'Train No': str})
        df.columns = df.columns.str.strip()
        train_info = df[df['Train No'] == train_no]

        if train_info.empty:
            return ["Error", "Train not found", "-", "-", "-"]
        
        return train_info.iloc[0].tolist()
    
    except FileNotFoundError:
        return ["Error", "File not found", "-", "-", "-"]
    except Exception as e:
        return ["Error", str(e), "-", "-", "-"]

def merge_with_ffmpeg(audios, output_file):
    valid_files = []
    missing_files = []

    for au in audios:
        if os.path.exists(au):
            valid_files.append(au)
        else:
            missing_files.append(au)

    if missing_files:
        print(f"⚠ Warning: Missing audio files: {', '.join(missing_files)}")

    if not valid_files:
        print("❌ Error: No valid audio files found to merge.")
        return "Error: No valid audio files found."

    list_file = "audio_list.txt"
    with open(list_file, "w") as f:
        for au in valid_files:
            f.write(f"file '{au}'\n")

    command = ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", list_file, "-c", "copy", output_file]

    try:
        result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if result.returncode != 0:
            print(f"❌ FFmpeg Error: ")
    except Exception as e:
        print(f"❌ Unexpected Error: ")

    os.remove(list_file)
    return output_file
def generateTrainNumber(train_number):
    aud = [f"{ch}_tel.mp3" for ch in train_number]
    announcement_file = f"{train_number}.mp3"
    return merge_with_ffmpeg(aud, announcement_file)


def generate_announcement(train_number, platform_number, annc_type):
    train_details = get_train_details(train_number)
    if train_details[0] == "Error":
        return f"Error: {train_details[1]}"
    
    from_station = f"{train_details[2]}.mp3"
    to_station = f"{train_details[3]}.mp3"
    train_name = f"{train_details[4]}.mp3"
    train_type = f"{train_details[5]}.mp3"
    generateTrainNumber(train_number)
    print(train_type)
    print(from_station)
    print(train_details)
    

    audios = []
    audios.append("daya_chesi.mp3")
    for ch in list(train_number):
        audios.append(f"{ch}_tel.mp3")
    audios.append( from_station )
    audios.append( to_station )
    audios.append( train_name)
    if train_type != "None.mp3":
        audios.append(train_type)
    if annc_type =="Arrive Shortly":
        audios.append("marikoddi.mp3")
        audios.append(f"{platform_number}_tel.mp3")
        audios.append("vacchunu.mp3")
    elif annc_type =="Is On":
        audios.append(f"{platform_number}_tel.mp3")
        audios.append("vunnadi.mp3")
    else:
        audios.append(f"{platform_number}_tel.mp3")
        audios.append("bayalderutaku.mp3")
        
        
        
    print(audios)
    announcement_file = f"SCR_{annc_type.replace(' ', '')}_{train_number}.mp3"
    return merge_with_ffmpeg(audios, announcement_file)
        
    
    




# Gradio Interface
with gr.Blocks() as demo:
    gr.Markdown("## 🚆 Train Announcement System")
    
    with gr.Row():
        train_number_input = gr.Textbox(label="Train Number", placeholder="Enter Train Number (e.g., 12345)")
        platform_number_input = gr.Textbox(label="Platform Number", placeholder="Enter Platform Number (e.g., 1)")
    
    annc_type_dropdown = gr.Dropdown(
        label="Announcement Type",
        choices=["Arrive Shortly", "Ready to Leave", "Is On"],
        value="Arrive Shortly"
    )
    
    output_audio = gr.Audio(label="Generated Announcement", type="filepath")
    generate_button = gr.Button("Generate Announcement")
    generate_button.click(generate_announcement, inputs=[train_number_input, platform_number_input, annc_type_dropdown], outputs=output_audio)

# Launch the app
demo.launch(share=True)"""


import pandas as pd
import os
import subprocess
import gradio as gr

# Load the Excel file once
FILE_NAME = "Train Details.xlsx"

def get_train_details(train_no):
    try:
        df = pd.read_excel(FILE_NAME, dtype={'Train No': str})
        df.columns = df.columns.str.strip()
        train_info = df[df['Train No'] == train_no]

        if train_info.empty:
            return ["Error", "Train not found", "-", "-", "-"]
        
        return train_info.iloc[0].tolist()
    
    except FileNotFoundError:
        return ["Error", "File not found", "-", "-", "-"]
    except Exception as e:
        return ["Error", str(e), "-", "-", "-"]

def merge_with_ffmpeg(audios, output_file):
    valid_files = []
    missing_files = []

    for au in audios:
        if os.path.exists(au):
            valid_files.append(au)
        else:
            missing_files.append(au)

    if missing_files:
        print(f"⚠ Warning: Missing audio files: {', '.join(missing_files)}")

    if not valid_files:
        print("❌ Error: No valid audio files found to merge.")
        return "Error: No valid audio files found."

    list_file = "audio_list.txt"
    with open(list_file, "w") as f:
        for au in valid_files:
            f.write(f"file '{au}'\n")

    command = ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", list_file, "-c", "copy", output_file]

    try:
        result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if result.returncode != 0:
            print(f"❌ FFmpeg Error: {result.stderr}")
    except Exception as e:
        print(f"❌ Unexpected Error: {str(e)}")

    os.remove(list_file)
    return output_file

def generateTrainNumber(train_number):
    aud = [f"{ch}_tel.mp3" for ch in train_number]
    announcement_file = f"{train_number}.mp3"
    return merge_with_ffmpeg(aud, announcement_file)

def generate_announcement(train_number, platform_number, annc_type):
    train_details = get_train_details(train_number)
    if train_details[0] == "Error":
        return f"Error: {train_details[1]}"

    train_no = train_number
    train_name = train_details[4]
    from_station = train_details[2]
    to_station = train_details[3]
    train_type = train_details[5]

    train_name_audio = f"{train_name}.mp3"
    from_station_audio = f"{from_station}.mp3"
    to_station_audio = f"{to_station}.mp3"
    train_type_audio = f"{train_type}.mp3"

    generateTrainNumber(train_number)

    audios = ["daya_chesi.mp3"]
    for ch in list(train_number):
        audios.append(f"{ch}_tel.mp3")
    audios.append(from_station_audio)
    #audios.append("nundi.mp3")
    audios.append(to_station_audio)
    #audios.append("vellavalsina.mp3")
    audios.append(train_name_audio)

    if train_type_audio != "None.mp3":
        audios.append(train_type_audio)

    if annc_type == "Arrive Shortly":
        audios.append("marikoddi.mp3")
        audios.append(f"{platform_number}_tel.mp3")
        audios.append("vacchunu.mp3")
    elif annc_type == "Is On":
        audios.append(f"{platform_number}_tel.mp3")
        audios.append("vunnadi.mp3")
    else:
        audios.append(f"{platform_number}_tel.mp3")
        audios.append("bayalderutaku.mp3")

    #English
    
    audios.append("kindAttention.mp3")
    for ch in list(train_number):
        audios.append(f"{ch}_eng.mp3")
    audios.append(from_station_audio)
    audios.append(to_station_audio)
    audios.append(train_name_audio)
    if train_type_audio != "None.mp3":
        audios.append(train_type_audio)
    if annc_type == "Arrive Shortly":
        audios.append("willArive.mp3")
        audios.append(f"{platform_number}_eng.mp3")

    elif annc_type == "Is On":
        audios.append( "isOn.mp3")
        audios.append(f"{platform_number}_eng.mp3")

    else:
        audios.append("isReadytoLeave.mp3")
        audios.append(f"{platform_number}_eng.mp3")

    #Hindi
    audios.append("yaatrikan.mp3")
    for ch in list(train_number):
        audios.append(f"{ch}_hin.mp3")
    audios.append(from_station_audio)
    #audios.append("se.mp3")
    audios.append(to_station_audio)
    
    #audios.append("koJane.mp3")
    audios.append(train_name_audio)
    if train_type_audio != "None.mp3":
        audios.append(train_type_audio)
    if annc_type == "Arrive Shortly":
        audios.append("krmank.mp3")
        audios.append(f"{platform_number}_hin.mp3")
        audios.append("parThodi.mp3")

    elif annc_type == "Is On":
        audios.append("krmank.mp3")
        audios.append(f"{platform_number}_hin.mp3")
        audios.append("ghadi.mp3")

    else:
        audios.append("krmank.mp3")
        audios.append(f"{platform_number}_hin.mp3")
        audios.append("ravana.mp3")
        
    

    announcement_file = f"SCR_{annc_type.replace(' ', '')}_{train_number}.mp3"
    return train_no, train_name, from_station, to_station, train_type, platform_number, merge_with_ffmpeg(audios, announcement_file)

# Gradio Interface
with gr.Blocks() as demo:
    gr.Markdown("## 🚆 South Central Railway Announcement System")

    with gr.Row():
        train_number_input = gr.Textbox(label="Train Number", placeholder="Enter Train Number (e.g., 12345)")
        platform_number_input = gr.Textbox(label="Platform Number", placeholder="Enter Platform Number (e.g., 1)")

    annc_type_dropdown = gr.Dropdown(
        label="Announcement Type",
        choices=["Arrive Shortly", "Ready to Leave", "Is On"],
        value="Arrive Shortly"
    )

    with gr.Row():
        with gr.Column():
            train_no_display = gr.Markdown("**Train Number:** ")
            train_name_display = gr.Markdown("**Train Name:** ")
            from_station_display = gr.Markdown("**From Station:** ")
        with gr.Column():
            to_station_display = gr.Markdown("**To Station:** ")
            train_type_display = gr.Markdown("**Train Type:** ")
            platform_display = gr.Markdown("**Platform Number:** ")

    output_audio = gr.Audio(label="Generated Announcement", type="filepath")
    generate_button = gr.Button("Generate Announcement")

    def update_display(train_number, platform_number, annc_type):
        train_no, train_name, from_station, to_station, train_type, platform, audio = generate_announcement(train_number, platform_number, annc_type)
        return (
            f"**Train Number:** {train_no}",
            f"**Train Name:** {train_name}",
            f"**From Station:** {from_station}",
            f"**To Station:** {to_station}",
            f"**Train Type:** {train_type}",
            f"**Platform Number:** {platform}",
            audio
        )

    generate_button.click(
        update_display, 
        inputs=[train_number_input, platform_number_input, annc_type_dropdown], 
        outputs=[train_no_display, train_name_display, from_station_display, to_station_display, train_type_display, platform_display, output_audio]
    )

# Launch the app
demo.launch(share=True)



