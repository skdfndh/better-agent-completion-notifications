Option Explicit

Dim shell
Dim command
Dim argumentIndex

Set shell = CreateObject("WScript.Shell")
command = "powershell.exe -NoProfile -WindowStyle Hidden"

For argumentIndex = 0 To WScript.Arguments.Count - 1
  command = command & " """ & WScript.Arguments.Item(argumentIndex) & """"
Next

shell.Run command, 0, False
