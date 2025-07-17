output "public_ip" {
  description = "Public IP of EC2 instance"
  value       = aws_instance.logalyze_instance.public_ip
}
